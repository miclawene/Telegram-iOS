import Postbox

public struct EncryptedRelaySettings: Codable, Equatable {
    public var host: String
    public var port: Int
    public var serverName: String?
    public var serverPublicKey: String
    public var pinnedCertificateHash: String?
    
    public init(host: String, port: Int, serverName: String?, serverPublicKey: String, pinnedCertificateHash: String?) {
        self.host = host
        self.port = port
        self.serverName = serverName
        self.serverPublicKey = serverPublicKey
        self.pinnedCertificateHash = pinnedCertificateHash
    }
}

public struct NetworkSettings: Codable {
    public var reducedBackupDiscoveryTimeout: Bool
    public var applicationUpdateUrlPrefix: String?
    public var backupHostOverride: String?
    public var useNetworkFramework: Bool?
    public var useExperimentalDownload: Bool?
    public var encryptedRelaySettings: EncryptedRelaySettings?
    
    public static var defaultSettings: NetworkSettings {
        return NetworkSettings(reducedBackupDiscoveryTimeout: false, applicationUpdateUrlPrefix: nil, backupHostOverride: nil, useNetworkFramework: nil, useExperimentalDownload: nil, encryptedRelaySettings: nil)
    }
    
    public init(reducedBackupDiscoveryTimeout: Bool, applicationUpdateUrlPrefix: String?, backupHostOverride: String?, useNetworkFramework: Bool?, useExperimentalDownload: Bool?, encryptedRelaySettings: EncryptedRelaySettings?) {
        self.reducedBackupDiscoveryTimeout = reducedBackupDiscoveryTimeout
        self.applicationUpdateUrlPrefix = applicationUpdateUrlPrefix
        self.backupHostOverride = backupHostOverride
        self.useNetworkFramework = useNetworkFramework
        self.useExperimentalDownload = useExperimentalDownload
        self.encryptedRelaySettings = encryptedRelaySettings
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: StringCodingKey.self)

        self.reducedBackupDiscoveryTimeout = ((try? container.decode(Int32.self, forKey: "reducedBackupDiscoveryTimeout")) ?? 0) != 0
        self.applicationUpdateUrlPrefix = try? container.decodeIfPresent(String.self, forKey: "applicationUpdateUrlPrefix")
        self.backupHostOverride = try? container.decodeIfPresent(String.self, forKey: "backupHostOverride")
        self.useNetworkFramework = try container.decodeIfPresent(Bool.self, forKey: "useNetworkFramework_v2")
        self.useExperimentalDownload = try container.decodeIfPresent(Bool.self, forKey: "useExperimentalDownload_v2")
        self.encryptedRelaySettings = try container.decodeIfPresent(EncryptedRelaySettings.self, forKey: "encryptedRelaySettings_v1")
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: StringCodingKey.self)

        try container.encode((self.reducedBackupDiscoveryTimeout ? 1 : 0) as Int32, forKey: "reducedBackupDiscoveryTimeout")
        try container.encodeIfPresent(self.applicationUpdateUrlPrefix, forKey: "applicationUpdateUrlPrefix")
        try container.encodeIfPresent(self.backupHostOverride, forKey: "backupHostOverride")
        try container.encodeIfPresent(self.useNetworkFramework, forKey: "useNetworkFramework_v2")
        try container.encodeIfPresent(self.useExperimentalDownload, forKey: "useExperimentalDownload_v2")
        try container.encodeIfPresent(self.encryptedRelaySettings, forKey: "encryptedRelaySettings_v1")
    }
}
