import CryptoKit
import Foundation
import Network
import Security

import MtProtoKit
import SwiftSignalKit

private enum EncryptedRelayFrameType: UInt8 {
    case clientHello = 1
    case serverHello = 2
    case data = 3
    case close = 4
}

private enum EncryptedRelayConstants {
    static let protocolMagic = Data("QRLY".utf8)
    static let protocolVersion: UInt8 = 1
    static let helloAckOk: UInt8 = 0
    static let maximumFrameLength = 4 * 1024 * 1024
    static let requestChunkLength = 256 * 1024
    static let keyInfoClientToServer = Data("quantum-relay-v1:c2s".utf8)
    static let keyInfoServerToClient = Data("quantum-relay-v1:s2c".utf8)
}

private func relayBase64Decode(_ value: String) -> Data? {
    if let data = Data(base64Encoded: value) {
        return data
    }
    var base64 = value
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let remainder = base64.count % 4
    if remainder != 0 {
        base64 += String(repeating: "=", count: 4 - remainder)
    }
    return Data(base64Encoded: base64)
}

private func relayNormalizeHex(_ value: String) -> String {
    return value
        .lowercased()
        .replacingOccurrences(of: ":", with: "")
        .replacingOccurrences(of: " ", with: "")
}

private func relayHexString(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
}

private func relayReadUInt16(_ data: Data, offset: Int) -> UInt16 {
    return data[offset..<(offset + 2)].reduce(UInt16(0)) { ($0 << 8) | UInt16($1) }
}

private func relayReadUInt32(_ data: Data, offset: Int) -> UInt32 {
    return data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
}

private func relayReadUInt64(_ data: Data, offset: Int) -> UInt64 {
    return data[offset..<(offset + 8)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
}

private extension Data {
    mutating func relayAppendUInt8(_ value: UInt8) {
        self.append(value)
    }
    
    mutating func relayAppendUInt16(_ value: UInt16) {
        var bigEndianValue = value.bigEndian
        withUnsafeBytes(of: &bigEndianValue) { bytes in
            self.append(contentsOf: bytes.bindMemory(to: UInt8.self))
        }
    }
    
    mutating func relayAppendUInt32(_ value: UInt32) {
        var bigEndianValue = value.bigEndian
        withUnsafeBytes(of: &bigEndianValue) { bytes in
            self.append(contentsOf: bytes.bindMemory(to: UInt8.self))
        }
    }
    
    mutating func relayAppendUInt64(_ value: UInt64) {
        var bigEndianValue = value.bigEndian
        withUnsafeBytes(of: &bigEndianValue) { bytes in
            self.append(contentsOf: bytes.bindMemory(to: UInt8.self))
        }
    }
}

extension EncryptedRelaySettings {
    var normalizedPinnedCertificateHash: String? {
        guard let pinnedCertificateHash, !pinnedCertificateHash.isEmpty else {
            return nil
        }
        return relayNormalizeHex(pinnedCertificateHash)
    }
    
    var validatedServerPublicKey: Curve25519.KeyAgreement.PublicKey? {
        guard let data = relayBase64Decode(self.serverPublicKey) else {
            return nil
        }
        return try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: data)
    }
    
    var isValid: Bool {
        return !self.host.isEmpty && self.port > 0 && self.port <= Int(UInt16.max) && self.validatedServerPublicKey != nil
    }
}

@available(iOS 13.0, macOS 14.0, *)
final class EncryptedRelayTcpConnectionInterface: NSObject, MTTcpConnectionInterface {
    private struct ReadRequest {
        let length: Int
        let tag: Int
    }
    
    private final class ExecutingReadRequest {
        let request: ReadRequest
        var data: Data
        var readyLength: Int = 0
        
        init(request: ReadRequest) {
            self.request = request
            self.data = Data(count: request.length)
        }
    }
    
    private enum HandshakeState {
        case idle
        case waitingForServerHello
        case ready
    }
    
    private final class Impl {
        private let queue: Queue
        private weak var delegate: MTTcpConnectionInterfaceDelegate?
        private let delegateQueue: DispatchQueue
        private let configuration: EncryptedRelaySettings
        private let serverPublicKey: Curve25519.KeyAgreement.PublicKey
        
        private var getLogPrefix: (() -> String)?
        private var connection: NWConnection?
        private var reportedDisconnection: Bool = false
        private var currentInterfaceIsWifi: Bool = true
        private var connectTimeoutTimer: SwiftSignalKit.Timer?
        private var usageCalculationInfo: MTNetworkUsageCalculationInfo?
        private var networkUsageManager: MTNetworkUsageManager?
        
        private var handshakeState: HandshakeState = .idle
        private var sessionId: Data?
        private var inboundKey: SymmetricKey?
        private var outboundKey: SymmetricKey?
        private var outboundSequence: UInt64 = 0
        private var inboundSequence: UInt64 = 0
        
        private var targetHost: String?
        private var targetPort: UInt16 = 0
        
        private var encryptedReceiveBuffer = Data()
        private var decryptedReceiveBuffer = Data()
        private var pendingWrites: [Data] = []
        private var readRequests: [ReadRequest] = []
        private var currentReadRequest: ExecutingReadRequest?
        
        init(
            queue: Queue,
            configuration: EncryptedRelaySettings,
            serverPublicKey: Curve25519.KeyAgreement.PublicKey,
            delegate: MTTcpConnectionInterfaceDelegate,
            delegateQueue: DispatchQueue
        ) {
            self.queue = queue
            self.configuration = configuration
            self.serverPublicKey = serverPublicKey
            self.delegate = delegate
            self.delegateQueue = delegateQueue
        }
        
        func setGetLogPrefix(_ getLogPrefix: (() -> String)?) {
            self.getLogPrefix = getLogPrefix
        }
        
        func setUsageCalculationInfo(_ usageCalculationInfo: MTNetworkUsageCalculationInfo?) {
            if self.usageCalculationInfo !== usageCalculationInfo {
                self.usageCalculationInfo = usageCalculationInfo
                if let usageCalculationInfo {
                    self.networkUsageManager = MTNetworkUsageManager(info: usageCalculationInfo)
                } else {
                    self.networkUsageManager = nil
                }
            }
        }
        
        func connect(host: String, port: UInt16, timeout: Double) {
            if self.connection != nil {
                assertionFailure("A connection already exists")
                return
            }
            
            self.targetHost = host
            self.targetPort = port
            self.handshakeState = .idle
            self.pendingWrites.removeAll(keepingCapacity: true)
            self.encryptedReceiveBuffer.removeAll(keepingCapacity: true)
            self.decryptedReceiveBuffer.removeAll(keepingCapacity: true)
            self.outboundSequence = 0
            self.inboundSequence = 0
            
            let host = NWEndpoint.Host(self.configuration.host)
            guard let port = NWEndpoint.Port(rawValue: UInt16(self.configuration.port)) else {
                self.cancelWithError(error: nil)
                return
            }
            
            let tcpOptions = NWProtocolTCP.Options()
            tcpOptions.noDelay = true
            tcpOptions.enableKeepalive = true
            tcpOptions.keepaliveIdle = 5
            tcpOptions.keepaliveCount = 2
            tcpOptions.keepaliveInterval = 5
            tcpOptions.enableFastOpen = true
            
            let tlsOptions = self.makeTLSOptions()
            let parameters = NWParameters(tls: tlsOptions, tcp: tcpOptions)
            let connection = NWConnection(host: host, port: port, using: parameters)
            self.connection = connection
            
            connection.stateUpdateHandler = { [weak self] state in
                self?.queue.async {
                    self?.stateUpdated(state: state)
                }
            }
            connection.pathUpdateHandler = { [weak self] path in
                self?.queue.async {
                    guard let self else {
                        return
                    }
                    self.currentInterfaceIsWifi = !path.usesInterfaceType(.cellular)
                }
            }
            connection.viabilityUpdateHandler = { [weak self] isViable in
                self?.queue.async {
                    if !isViable {
                        self?.cancelWithError(error: nil)
                    }
                }
            }
            
            self.connectTimeoutTimer = SwiftSignalKit.Timer(timeout: timeout, repeat: false, completion: { [weak self] in
                guard let self else {
                    return
                }
                self.connectTimeoutTimer = nil
                self.cancelWithError(error: nil)
            }, queue: self.queue)
            self.connectTimeoutTimer?.start()
            
            connection.start(queue: self.queue.queue)
        }
        
        private func makeTLSOptions() -> NWProtocolTLS.Options {
            let options = NWProtocolTLS.Options()
            let securityOptions = options.securityProtocolOptions
            sec_protocol_options_set_min_tls_protocol_version(securityOptions, .TLSv13)
            if let serverName = self.configuration.serverName, !serverName.isEmpty {
                sec_protocol_options_set_tls_server_name(securityOptions, serverName)
            }
            let pinnedCertificateHash = self.configuration.normalizedPinnedCertificateHash
            sec_protocol_options_set_verify_block(securityOptions, { metadata, secTrust, complete in
                let trust = sec_trust_copy_ref(secTrust).takeRetainedValue()
                guard SecTrustEvaluateWithError(trust, nil) else {
                    complete(false)
                    return
                }
                if let pinnedCertificateHash {
                    guard let certificate = SecTrustGetCertificateAtIndex(trust, 0) else {
                        complete(false)
                        return
                    }
                    let certificateData = SecCertificateCopyData(certificate) as Data
                    let digest = relayHexString(Data(SHA256.hash(data: certificateData)))
                    complete(digest == pinnedCertificateHash)
                } else {
                    complete(true)
                }
                _ = metadata
            }, self.queue.queue)
            return options
        }
        
        private func stateUpdated(state: NWConnection.State) {
            switch state {
            case .ready:
                if let path = self.connection?.currentPath {
                    self.currentInterfaceIsWifi = !path.usesInterfaceType(.cellular)
                }
                self.startReceiving()
                self.sendClientHello()
            case let .failed(error):
                self.cancelWithError(error: error)
            default:
                break
            }
        }
        
        private func sendClientHello() {
            guard let targetHost = self.targetHost, !targetHost.isEmpty else {
                self.cancelWithError(error: nil)
                return
            }
            let hostData = Data(targetHost.utf8)
            guard hostData.count <= Int(UInt16.max) else {
                self.cancelWithError(error: nil)
                return
            }
            
            let sessionIdLength = 16
            var sessionIdBytes = [UInt8](repeating: 0, count: sessionIdLength)
            if SecRandomCopyBytes(kSecRandomDefault, sessionIdLength, &sessionIdBytes) != errSecSuccess {
                self.cancelWithError(error: nil)
                return
            }
            
            let clientPrivateKey = Curve25519.KeyAgreement.PrivateKey()
            guard let sharedSecret = try? clientPrivateKey.sharedSecretFromKeyAgreement(with: self.serverPublicKey) else {
                self.cancelWithError(error: nil)
                return
            }
            
            let sessionId = Data(sessionIdBytes)
            self.sessionId = sessionId
            self.outboundKey = sharedSecret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: sessionId, sharedInfo: EncryptedRelayConstants.keyInfoClientToServer, outputByteCount: 32)
            self.inboundKey = sharedSecret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: sessionId, sharedInfo: EncryptedRelayConstants.keyInfoServerToClient, outputByteCount: 32)
            
            var payload = Data()
            payload.append(EncryptedRelayConstants.protocolMagic)
            payload.relayAppendUInt8(EncryptedRelayConstants.protocolVersion)
            payload.append(sessionId)
            payload.append(clientPrivateKey.publicKey.rawRepresentation)
            payload.relayAppendUInt16(self.targetPort)
            payload.relayAppendUInt16(UInt16(hostData.count))
            payload.append(hostData)
            
            self.handshakeState = .waitingForServerHello
            self.sendRawFrame(type: .clientHello, sequence: 0, payload: payload)
        }
        
        func write(data: Data) {
            if self.handshakeState == .ready {
                self.sendEncryptedFrame(type: .data, plaintext: data)
            } else {
                self.pendingWrites.append(data)
            }
        }
        
        func read(length: Int, timeout: Double, tag: Int) {
            _ = timeout
            self.readRequests.append(ReadRequest(length: length, tag: tag))
            self.processReadRequests()
        }
        
        private func startReceiving() {
            guard let connection = self.connection else {
                return
            }
            connection.receive(minimumIncompleteLength: 1, maximumLength: EncryptedRelayConstants.requestChunkLength) { [weak self] data, _, isComplete, error in
                self?.queue.async {
                    guard let self else {
                        return
                    }
                    if let data, !data.isEmpty {
                        self.networkUsageManager?.addIncomingBytes(UInt(data.count), interface: self.currentInterfaceIsWifi ? MTNetworkUsageManagerInterfaceOther : MTNetworkUsageManagerInterfaceWWAN)
                        self.encryptedReceiveBuffer.append(data)
                        self.processEncryptedFrames()
                    }
                    if isComplete || error != nil {
                        self.cancelWithError(error: error)
                    } else {
                        self.startReceiving()
                    }
                }
            }
        }
        
        private func processEncryptedFrames() {
            while self.encryptedReceiveBuffer.count >= 4 {
                let frameLength = Int(relayReadUInt32(self.encryptedReceiveBuffer, offset: 0))
                if frameLength < 9 || frameLength > EncryptedRelayConstants.maximumFrameLength {
                    self.cancelWithError(error: nil)
                    return
                }
                if self.encryptedReceiveBuffer.count < 4 + frameLength {
                    return
                }
                let frame = Data(self.encryptedReceiveBuffer[4..<(4 + frameLength)])
                self.encryptedReceiveBuffer.removeSubrange(0..<(4 + frameLength))
                self.processFrame(frame)
            }
        }
        
        private func processFrame(_ frame: Data) {
            guard frame.count >= 9, let frameType = EncryptedRelayFrameType(rawValue: frame[0]) else {
                self.cancelWithError(error: nil)
                return
            }
            let sequence = relayReadUInt64(frame, offset: 1)
            let payload = Data(frame[9...])
            
            switch frameType {
            case .clientHello:
                self.cancelWithError(error: nil)
            case .serverHello:
                guard self.handshakeState == .waitingForServerHello else {
                    self.cancelWithError(error: nil)
                    return
                }
                guard sequence == self.inboundSequence, let plaintext = self.decrypt(type: .serverHello, sequence: sequence, payload: payload) else {
                    self.cancelWithError(error: nil)
                    return
                }
                self.inboundSequence += 1
                guard plaintext.first == EncryptedRelayConstants.helloAckOk else {
                    self.cancelWithError(error: nil)
                    return
                }
                self.handshakeState = .ready
                if let connectTimeoutTimer = self.connectTimeoutTimer {
                    self.connectTimeoutTimer = nil
                    connectTimeoutTimer.invalidate()
                }
                let delegate = self.delegate
                self.delegateQueue.async { [weak delegate] in
                    delegate?.connectionInterfaceDidConnect()
                }
                self.flushPendingWrites()
                self.processReadRequests()
            case .data:
                guard self.handshakeState == .ready else {
                    self.cancelWithError(error: nil)
                    return
                }
                guard sequence == self.inboundSequence, let plaintext = self.decrypt(type: .data, sequence: sequence, payload: payload) else {
                    self.cancelWithError(error: nil)
                    return
                }
                self.inboundSequence += 1
                self.decryptedReceiveBuffer.append(plaintext)
                self.processReadRequests()
            case .close:
                self.cancelWithError(error: nil)
            }
        }
        
        private func processReadRequests() {
            if self.currentReadRequest == nil, !self.readRequests.isEmpty {
                self.currentReadRequest = ExecutingReadRequest(request: self.readRequests.removeFirst())
            }
            guard let currentReadRequest = self.currentReadRequest else {
                return
            }
            if self.decryptedReceiveBuffer.isEmpty {
                return
            }
            
            let remaining = currentReadRequest.request.length - currentReadRequest.readyLength
            let readCount = min(remaining, self.decryptedReceiveBuffer.count)
            let chunk = self.decryptedReceiveBuffer.prefix(readCount)
            currentReadRequest.data.withUnsafeMutableBytes { buffer in
                guard let baseAddress = buffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                    return
                }
                chunk.copyBytes(to: baseAddress.advanced(by: currentReadRequest.readyLength), count: readCount)
            }
            currentReadRequest.readyLength += readCount
            self.decryptedReceiveBuffer.removeSubrange(0..<readCount)
            
            let tag = currentReadRequest.request.tag
            let delegate = self.delegate
            self.delegateQueue.async { [weak delegate] in
                delegate?.connectionInterfaceDidReadPartialData(ofLength: UInt(readCount), tag: tag)
            }
            
            if currentReadRequest.readyLength == currentReadRequest.request.length {
                self.currentReadRequest = nil
                let currentInterfaceIsWifi = self.currentInterfaceIsWifi
                self.delegateQueue.async { [weak delegate] in
                    delegate?.connectionInterfaceDidRead(currentReadRequest.data, withTag: currentReadRequest.request.tag, networkType: currentInterfaceIsWifi ? 0 : 1)
                }
                self.processReadRequests()
            }
        }
        
        private func flushPendingWrites() {
            while !self.pendingWrites.isEmpty {
                let data = self.pendingWrites.removeFirst()
                self.sendEncryptedFrame(type: .data, plaintext: data)
            }
        }
        
        private func sendEncryptedFrame(type: EncryptedRelayFrameType, plaintext: Data) {
            guard let payload = self.encrypt(type: type, sequence: self.outboundSequence, plaintext: plaintext) else {
                self.cancelWithError(error: nil)
                return
            }
            self.sendRawFrame(type: type, sequence: self.outboundSequence, payload: payload)
            self.outboundSequence += 1
        }
        
        private func sendRawFrame(type: EncryptedRelayFrameType, sequence: UInt64, payload: Data) {
            guard let connection = self.connection else {
                if let getLogPrefix = self.getLogPrefix {
                    Logger.shared.log("EncryptedRelayTcpConnectionInterface", "\(getLogPrefix()) write called while connection == nil")
                } else {
                    Logger.shared.log("EncryptedRelayTcpConnectionInterface", "write called while connection == nil")
                }
                return
            }
            let frameLength = 1 + 8 + payload.count
            guard frameLength <= EncryptedRelayConstants.maximumFrameLength else {
                self.cancelWithError(error: nil)
                return
            }
            var frame = Data()
            frame.relayAppendUInt32(UInt32(frameLength))
            frame.relayAppendUInt8(type.rawValue)
            frame.relayAppendUInt64(sequence)
            frame.append(payload)
            
            connection.send(content: frame, completion: .contentProcessed({ [weak self] error in
                guard let self else {
                    return
                }
                self.queue.async {
                    if let error {
                        self.cancelWithError(error: error)
                    }
                }
            }))
            self.networkUsageManager?.addOutgoingBytes(UInt(frame.count), interface: self.currentInterfaceIsWifi ? MTNetworkUsageManagerInterfaceOther : MTNetworkUsageManagerInterfaceWWAN)
        }
        
        private func makeNonce(sequence: UInt64) -> ChaChaPoly.Nonce? {
            guard let sessionId, sessionId.count >= 4 else {
                return nil
            }
            var nonceData = Data(sessionId.prefix(4))
            nonceData.relayAppendUInt64(sequence)
            return try? ChaChaPoly.Nonce(data: nonceData)
        }
        
        private func encrypt(type: EncryptedRelayFrameType, sequence: UInt64, plaintext: Data) -> Data? {
            guard let outboundKey, let nonce = self.makeNonce(sequence: sequence) else {
                return nil
            }
            var authenticatedData = Data()
            authenticatedData.relayAppendUInt8(type.rawValue)
            authenticatedData.relayAppendUInt64(sequence)
            guard let sealedBox = try? ChaChaPoly.seal(plaintext, using: outboundKey, nonce: nonce, authenticating: authenticatedData) else {
                return nil
            }
            var payload = Data()
            payload.append(sealedBox.ciphertext)
            payload.append(sealedBox.tag)
            return payload
        }
        
        private func decrypt(type: EncryptedRelayFrameType, sequence: UInt64, payload: Data) -> Data? {
            guard payload.count >= 16, let inboundKey, let nonce = self.makeNonce(sequence: sequence) else {
                return nil
            }
            let ciphertext = payload.dropLast(16)
            let tag = payload.suffix(16)
            let sealedBox: ChaChaPoly.SealedBox
            do {
                sealedBox = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            } catch {
                return nil
            }
            var authenticatedData = Data()
            authenticatedData.relayAppendUInt8(type.rawValue)
            authenticatedData.relayAppendUInt64(sequence)
            return try? ChaChaPoly.open(sealedBox, using: inboundKey, authenticating: authenticatedData)
        }
        
        func disconnect() {
            self.cancelWithError(error: nil)
        }
        
        func resetDelegate() {
            self.delegate = nil
        }
        
        private func cancelWithError(error: Error?) {
            if let connectTimeoutTimer = self.connectTimeoutTimer {
                self.connectTimeoutTimer = nil
                connectTimeoutTimer.invalidate()
            }
            
            if !self.reportedDisconnection {
                self.reportedDisconnection = true
                let delegate = self.delegate
                self.delegateQueue.async { [weak delegate] in
                    delegate?.connectionInterfaceDidDisconnectWithError(error)
                }
            }
            if let connection = self.connection {
                self.connection = nil
                connection.cancel()
            }
        }
    }
    
    private static let sharedQueue = Queue(name: "EncryptedRelayTcpConnectionInterface")
    
    private let queue: Queue
    private let impl: QueueLocalObject<Impl>
    
    init(configuration: EncryptedRelaySettings, delegate: MTTcpConnectionInterfaceDelegate, delegateQueue: DispatchQueue) {
        let queue = EncryptedRelayTcpConnectionInterface.sharedQueue
        self.queue = queue
        let serverPublicKey = configuration.validatedServerPublicKey!
        self.impl = QueueLocalObject(queue: queue, generate: {
            return Impl(
                queue: queue,
                configuration: configuration,
                serverPublicKey: serverPublicKey,
                delegate: delegate,
                delegateQueue: delegateQueue
            )
        })
    }
    
    func setGetLogPrefix(_ getLogPrefix: (() -> String)?) {
        self.impl.with { impl in
            impl.setGetLogPrefix(getLogPrefix)
        }
    }
    
    func setUsageCalculationInfo(_ usageCalculationInfo: MTNetworkUsageCalculationInfo?) {
        self.impl.with { impl in
            impl.setUsageCalculationInfo(usageCalculationInfo)
        }
    }
    
    func connect(toHost inHost: String, onPort port: UInt16, viaInterface inInterface: String?, withTimeout timeout: TimeInterval, error errPtr: NSErrorPointer) -> Bool {
        _ = inInterface
        _ = errPtr
        self.impl.with { impl in
            impl.connect(host: inHost, port: port, timeout: timeout)
        }
        return true
    }
    
    func write(_ data: Data) {
        self.impl.with { impl in
            impl.write(data: data)
        }
    }
    
    func readData(toLength length: UInt, withTimeout timeout: TimeInterval, tag: Int) {
        self.impl.with { impl in
            impl.read(length: Int(length), timeout: timeout, tag: tag)
        }
    }
    
    func disconnect() {
        self.impl.with { impl in
            impl.disconnect()
        }
    }
    
    func resetDelegate() {
        self.impl.with { impl in
            impl.resetDelegate()
        }
    }
}
