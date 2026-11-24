export type Envelope<T> = { success: boolean; data: T | null; error: ApiError | null }
export type ApiError = { code: string; message: string }

export type AuthResult = {
  status: 'SUCCESS' | 'FACE_VERIFICATION_REQUIRED'
  accessToken?: string
  refreshToken?: string
  tokenType?: string
  expiresInSeconds?: number
  challengeId?: string
  challengeNonce?: string
  riskScore?: number
  riskReasons: string[]
  faceEnrolled?: boolean
  recommendEnrollment?: boolean
}

export type Profile = {
  id: number
  email: string
  fullName: string
  status: string
  emailVerified: boolean
  organizationId?: number | null
  activeOrganizationId?: number | null
  organizationName?: string | null
  organization?: { id: number; name: string } | null
  orgRole?: string | null
  systemRole?: string | null
  permissions?: string[]
  memberships?: OrganizationMembership[]
  lastLoginAt?: string | null
  faceEnrolled: boolean
  avatarVersion?: string | null
  pendingInvitationCount?: number
}

export type FaceStatus = { enrolled: boolean; samplesStored: number }
export type OrganizationMembership = {
  organizationId: number
  name: string
  organizationName?: string
  type: 'OWNER' | 'STAFF' | 'CLIENT' | string
  role: string
  status: string
  permissions: string[]
  logoVersion: string | null
}
export type OrganizationInvitation = {
  invitationId: number
  organizationId: number
  organizationName: string
  logoVersion: string | null
  role: string
  type: 'STAFF' | 'CLIENT'
  invitedBy: string
  invitedAt: string
  expiresAt: string
}
export type Device = {
  id: number
  deviceName: string
  maskedIp: string | null
  trusted: boolean
  current?: boolean
  firstSeen: string
  lastSeen: string
}
export type ActivityEntry = {
  id: number
  time: string
  eventType: string
  action: string
  result: 'success' | 'failed' | 'not required' | string
  approximateLocation: string | null
  deviceLabel: string | null
  maskedIp: string | null
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high'
  riskReasons: string[]
  verificationResult: string | null
}
export type SecuritySummary = {
  lastSuccessfulLoginAt: string | null
  lastLoginLocation: string | null
  lastLoginDevice: string | null
  latestRiskScore: number | null
  latestRiskLevel: 'low' | 'medium' | 'high' | null
  faceEnrolled: boolean
  faceSampleCount: number
  trustedDevicesCount: number
  failedAttemptsLast7Days: number
}
export type Organization = {
  id: number
  name: string
  logoUrl: string | null
  currency: string
  taxSettings: string | null
  maskedBankDetails: string | null
  logoVersion?: string | null
}
export type OrgRole = 'OWNER' | 'ORG_ADMIN' | 'ACCOUNTANT' | 'STAFF' | 'VIEWER' | 'CLIENT' | 'SUPER_ADMIN'
export type Member = {
  userId: number
  email: string
  fullName: string | null
  role: OrgRole
  status: string
  invitedAt: string | null
  avatarVersion?: string | null
}
export type MemberSearchResult = {
  userId: number
  fullName: string
  email: string
  avatarThumbnail: string | null
  state: 'AVAILABLE' | 'ALREADY_MEMBER' | 'ALREADY_INVITED'
}
export type ActivityPage = { content: ActivityEntry[]; page: number; size: number; totalElements: number }
export type AuditEntry = {
  id: number
  actorId: number
  action: string
  entityType: string | null
  entityId: string | null
  ipAddress: string | null
  device: string | null
  location: string | null
  riskScore: number | null
  verificationResult: string | null
  details: string | null
  timestamp: string
}
export type AuditPage = { content: AuditEntry[]; page: number; size: number; totalElements: number }
export type RiskyLogin = {
  email: string
  ipAddress: string | null
  riskScore: number
  riskReasons: string
  outcome: string
  timestamp: string
}
export type DashboardSummary = {
  loginsPerDay: { day: string; total: number; failed: number }[]
  failedLogins: number
  faceVerificationSuccessRate: number
  highRiskLogins: number
  stepUpCount: number
  topRiskyUsers: { userId: number; email: string; failedAttempts: number; maxRiskScore: number }[]
  topRiskyDevices: { deviceReference: string; attempts: number; maxRiskScore: number }[]
}

export function unwrap<T>(envelope: Envelope<T>): T {
  if (!envelope.success || envelope.data === null) {
    throw new Error(envelope.error?.code ?? 'UNKNOWN_ERROR')
  }
  return envelope.data
}
