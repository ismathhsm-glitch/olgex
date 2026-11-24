import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import {
  getData, sendData, putData, deleteData,
} from '../api/requests'
import { getApiError } from '../api/errors'
import { setActiveOrganizationId, useActiveOrganizationId } from '../api/organizationContext'
import { removeImage, uploadImage } from '../api/images'
import type {
  ActivityEntry, AuditEntry, AuditPage, DashboardSummary, Device, FaceStatus, Member, MemberSearchResult, Organization, OrganizationInvitation, OrgRole, Profile, RiskyLogin,
} from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { getDeviceHash } from '../auth/deviceHash'
import { captureDescriptor } from '../face/descriptor'
import Camera, { CameraPermissionHelp } from '../components/Camera'
import { useStepUp } from '../components/StepUp'
import { Avatar } from '../components/Avatar'
import { AvatarUploader } from '../components/AvatarUploader'
import {
  Badge, Button, Callout, DataTable, Dialog, EmptyState, Feedback, Input, MetricCard, SectionHeading, Skeleton,
} from '../components/ui'
import { passwordRules } from './validation'
import { formatTimestamp } from '../utils/formatTimestamp'

function PageError({ error, title = 'We could not load this page' }: { error: unknown; title?: string }) {
  const parsed = getApiError(error)
  return <Feedback tone="error" title={title}>{parsed.message}</Feedback>
}

function InvitationCard({ invitation }: { invitation: OrganizationInvitation }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState('')
  const roleName = invitation.type === 'CLIENT'
    ? 'Client'
    : ({ ACCOUNTANT: 'Accountant', STAFF: 'Staff', VIEWER: 'Viewer' }[invitation.role] ?? invitation.role)

  const respond = async (decision: 'accept' | 'decline') => {
    setBusy(decision)
    setError('')
    try {
      await sendData(`/users/me/invitations/${invitation.invitationId}/${decision}`, {})
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['memberships'] }),
      ])
    } catch (reason) {
      setError(getApiError(reason).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="organization-card">
      <div className="organization-card-heading">
        <Avatar name={invitation.organizationName} path={`/organizations/${invitation.organizationId}/logo`} version={invitation.logoVersion} size={40} alt={`${invitation.organizationName} logo`} />
        <strong>{invitation.organizationName}</strong>
        <Badge tone="warning">Pending</Badge>
      </div>
      <p>Invited as {roleName} by {invitation.invitedBy} on {formatTimestamp(invitation.invitedAt)}.</p>
      {error && <Feedback tone="error" title="Invitation action failed">{error}</Feedback>}
      <div className="button-row">
        <Button loading={busy === 'accept'} disabled={busy !== null} onClick={() => void respond('accept')}>Accept</Button>
        <Button variant="secondary" loading={busy === 'decline'} disabled={busy !== null} onClick={() => void respond('decline')}>Decline</Button>
      </div>
    </article>
  )
}

function memberStatusLabel(status: string) {
  return ({ INVITED: 'Invited', ACTIVE: 'Active', DECLINED: 'Declined', REVOKED: 'Revoked', EXPIRED: 'Expired' }[status] ?? status)
}

function highlightEmail(email: string, query: string) {
  const match = email.slice(0, query.length)
  return email.toLowerCase().startsWith(query.toLowerCase())
    ? <><mark>{match}</mark>{email.slice(query.length)}</>
    : email
}

export function HomePage() {
  const { role } = useAuth()
  const isAdmin = role === 'ORG_ADMIN'
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => getData<Profile>('/users/me') })
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => getData<Device[]>('/devices') })
  const summary = useQuery({
    queryKey: ['security-summary'],
    queryFn: () => getData<DashboardSummary>('/security/dashboard-summary'),
    enabled: isAdmin,
  })
  const activity = useQuery({
    queryKey: ['home-activity', isAdmin],
    queryFn: async (): Promise<HomeActivity> => {
      if (isAdmin) {
        const page = await getData<AuditPage>('/audit-logs?page=0&size=10')
        return { scope: 'organization', entries: page.content }
      }
      const page = await getData<{ content: ActivityEntry[] }>('/users/me/activity?page=0&size=10')
      return { scope: 'personal', entries: page.content }
    },
    enabled: Boolean(profile.data),
  })

  if (profile.isLoading || devices.isLoading || (isAdmin && summary.isLoading)) return <Skeleton lines={7} />
  if (profile.isError) return <PageError error={profile.error} />
  if (devices.isError) return <PageError error={devices.error} />

  const trusted = devices.data?.filter((device) => device.trusted).length ?? 0
  const metrics = [
    { label: 'Face security', value: profile.data?.faceEnrolled ? 'Enrolled' : 'Not enrolled', status: profile.data?.faceEnrolled ? 'Active' : 'Not verified', context: 'Account verification' },
    { label: 'Trusted devices', value: trusted, status: 'Active', context: `${devices.data?.length ?? 0} recognized devices` },
    ...(profile.data?.lastLoginAt ? [{
      label: 'Last login',
      value: formatTimestamp(profile.data.lastLoginAt),
      status: 'Previous sign-in',
      context: 'Your previous successful sign-in',
    }] : []),
  ]
  const permissions = profile.data?.permissions ?? []
  const allowedActions = permissions.map((permission) => permissionLabels[permission] ?? permission)
  const restrictedActions = Object.entries(permissionLabels)
    .filter(([permission]) => !permissions.includes(permission))
    .map(([, description]) => description)
  const organizationName = profile.data?.organization?.name ?? profile.data?.organizationName
  const hasOrganization = Boolean(profile.data?.organization?.id ?? profile.data?.organizationId)

  return (
    <div className="page-stack">
      <SectionHeading title="Home" description="Your account security at a glance." />
      {profile.data && !profile.data.faceEnrolled && <Callout title="Enrol your face">Face verification helps protect sign-ins and sensitive organization changes. It is not enrolled for this account yet.</Callout>}
      {isAdmin && summary.isError && <PageError error={summary.error} title="Security summary is unavailable" />}
      <div className="metric-grid">
        {metrics.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} context={metric.context} badge={<Badge>{metric.status}</Badge>} />)}
        {isAdmin && summary.data && <MetricCard label="High-risk logins" value={summary.data.highRiskLogins} context="Last 7 days" badge={<Badge tone="warning">Review</Badge>} />}
      </div>
      <div className="content-grid">
        <section className="panel">
          <div className="panel-title-row"><div><h2>Your access</h2><p>{organizationName ? `Organization: ${organizationName}` : 'Your account access'}</p></div><Badge>{profile.data?.orgRole === 'ORG_ADMIN' ? 'Business Owner' : profile.data?.orgRole ?? role ?? 'Member'}</Badge></div>
          {!hasOrganization ? (
            <Callout title="No organization is attached to this account">Your profile and personal account security are still available.</Callout>
          ) : (
            <div className="access-lists">
              <div><strong>Can do</strong><ul>
                <li>Manage your own profile, password, devices, and face security.</li>
                {allowedActions.length > 0 ? allowedActions.map((action) => <li key={action}>{action}</li>) : <li>No organization permissions are assigned.</li>}
              </ul></div>
              <div><strong>Cannot do</strong><ul>
                {restrictedActions.length > 0
                  ? restrictedActions.map((action) => <li key={action}>{action}</li>)
                  : <li>No organization actions are restricted by your permissions.</li>}
              </ul></div>
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Security overview</h2>
          <p>Keep your account and organization settings up to date.</p>
          <div className="quick-links">
            <a href="/face">Review face security</a>
            <a href="/profile">Manage profile and devices</a>
            {hasOrganization && <a href="/organization">Organization settings</a>}
          </div>
        </section>
        <section className="panel">
          <h2>Account details</h2>
          <dl className="detail-list">
            <div><dt>Signed in as</dt><dd>{profile.data?.fullName}</dd></div>
            <div><dt>Email</dt><dd>{profile.data?.email}</dd></div>
            <div><dt>Email verification</dt><dd><Badge>{profile.data?.emailVerified ? 'Active' : 'Not verified'}</Badge></dd></div>
          </dl>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title-row">
          <div><h2>Recent activity</h2><p>{isAdmin ? 'The latest security activity in your organization.' : 'Your latest security events.'}</p></div>
          {isAdmin && <Link to="/security-audit">View full audit log</Link>}
        </div>
        {activity.isLoading ? <Skeleton lines={3} />
          : activity.isError ? <PageError error={activity.error} title="Recent activity is unavailable" />
            : !activity.data ? <Skeleton lines={3} />
            : activity.data.entries.length === 0
              ? <EmptyState title="No recent activity" description="Security events will appear here as they occur." />
              : <ul className="activity-list">{activity.data.entries.map((entry, index) => {
                const timestamp = 'timestamp' in entry ? entry.timestamp : entry.time
                const result = entry.verificationResult ?? ('result' in entry ? entry.result : null)
                const actor = 'actorId' in entry ? ` · User ${entry.actorId}` : ''
                return <li key={`${entry.action}-${timestamp}-${index}`}>
                  <div><strong>{entry.action.replaceAll('_', ' ')}</strong><small>{result ?? 'Not required'}{actor}</small></div>
                  <time>{formatTimestamp(timestamp)}</time>
                </li>
              })}</ul>}
      </section>
    </div>
  )
}

type HomeActivity = { scope: 'organization'; entries: AuditEntry[] }
  | { scope: 'personal'; entries: ActivityEntry[] }

const permissionLabels: Record<string, string> = {
  INVOICES_VIEW: 'View invoices',
  INVOICES_EDIT: 'Create and edit invoices',
  PAYMENTS_VIEW: 'View payments',
  PAYMENTS_EDIT: 'Manage payments',
  EXPENSES_VIEW: 'View expenses',
  EXPENSES_EDIT: 'Manage expenses',
  REPORTS_VIEW: 'View reports',
  VIEW_ORG_AUDIT: 'View organization security activity',
  VIEW_SECURITY_DASHBOARD: 'View the security dashboard',
  EDIT_BANK_DETAILS: 'Edit bank details',
  MANAGE_MEMBERS: 'Invite and manage organization members',
  TRANSFER_ADMIN: 'Transfer administrator ownership',
  EDIT_ORG_SETTINGS: 'Edit organization settings',
}

export function FacePage() {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [samples, setSamples] = useState<number[][]>([])
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reenrolling, setReenrolling] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const status = useQuery({ queryKey: ['face-status'], queryFn: () => getData<FaceStatus>('/face/status') })

  const capture = async () => {
    if (!videoRef.current) return
    setError('')
    try {
      const descriptor = await captureDescriptor(videoRef.current)
      setSamples((current) => current.length >= 3 ? current : [...current, descriptor])
      setNotice(`Sample ${Math.min(samples.length + 1, 3)} captured. Images stay in your browser; only a numeric face descriptor is submitted.`)
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  }

  const enroll = async () => {
    if (samples.length !== 3) return
    setBusy(true)
    setError('')
    try {
      await sendData('/face/enroll', { samples })
      setSamples([])
      setReenrolling(false)
      setNotice('Face enrolment completed.')
      await queryClient.invalidateQueries({ queryKey: ['face-status'] })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (reason) {
      setError(getApiError(reason).message)
    } finally {
      setBusy(false)
    }
  }

  const testVerification = async () => {
    if (!videoRef.current) return
    setBusy(true)
    setError('')
    setTestResult('')
    try {
      const challenge = await sendData<{ challengeId: string; nonce: string }>(
        '/face/verify-self/initiate', {})
      const embedding = await captureDescriptor(videoRef.current)
      await sendData('/face/verify-self', {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        timestamp: new Date().toISOString(),
        embedding,
      })
      setTestResult('Face matched')
    } catch (reason) {
      const parsed = getApiError(reason)
      if (parsed.message === 'FACE_MISMATCH' || parsed.code === 'FACE_MISMATCH') {
        setTestResult('Face did not match, try again')
      } else {
        setError(parsed.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const removeEnrollment = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteData('/face/enrollment')
      setConfirmDelete(false)
      setNotice('Face enrolment was deleted.')
      await queryClient.invalidateQueries({ queryKey: ['face-status'] })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (reason) {
      setError(getApiError(reason).message)
    } finally {
      setBusy(false)
    }
  }

  if (status.isLoading) return <Skeleton lines={6} />
  if (status.isError) return <PageError error={status.error} />

  return (
    <div className="page-stack">
      <SectionHeading title="Face Security" description="Manage the face descriptor used to verify your identity." />
      <section className="panel">
        <div className="panel-title-row"><div><h2>Face enrolment</h2><p>Capture exactly three samples in a well-lit space.</p></div><Badge>{status.data?.enrolled ? 'Active' : 'Not verified'}</Badge></div>
        {status.data?.enrolled && <Callout tone="success" title="Face enrolled">{status.data.samplesStored} descriptor samples are enrolled for this account.</Callout>}
        {(!status.data?.enrolled || reenrolling || testing) && (
          <div className="face-layout">
            <div>
              {!cameraError && !error ? <Camera onError={setCameraError} ref={videoRef} /> : (
                <div className="stack">
                  {cameraError && <><Feedback tone="error" title="Camera unavailable">{cameraError}</Feedback><CameraPermissionHelp /></>}
                  {error && <Feedback tone="error" title="Face security action failed">{error}</Feedback>}
                  <Button variant="secondary" onClick={() => { setCameraError(''); setError('') }}>Try camera again</Button>
                </div>
              )}
            </div>
            <div className="face-guidance">
              {testing
                ? <><h3>Test your enrolled face</h3><p>Use a well-lit room and make sure only you are visible. Your similarity score is never shown.</p>
                  <div className="button-row">
                    <Button loading={busy} disabled={Boolean(cameraError)} onClick={() => void testVerification()}>Capture and verify</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => { setTesting(false); setError('') }}>Cancel</Button>
                  </div></>
                : <><h3>Before you begin</h3>
                  <ul><li>Use a well-lit room and face the camera.</li><li>Only one face should be visible.</li><li>Images are not uploaded or stored; only a numeric face descriptor is submitted.</li></ul>
                  <div className="sample-progress" aria-label={`${samples.length} of 3 samples captured`}>
                    {[0, 1, 2].map((step) => <div key={step} className={`sample-step ${step < samples.length ? 'sample-complete' : ''}`}><span>{step < samples.length ? '✓' : step + 1}</span><small>Sample {step + 1}</small></div>)}
                  </div>
                  <div className="button-row">
                    <Button variant="secondary" disabled={samples.length >= 3 || Boolean(cameraError)} onClick={() => void capture()}>Capture sample {Math.min(samples.length + 1, 3)}</Button>
                    <Button loading={busy} disabled={samples.length !== 3} onClick={() => void enroll()}>Enrol face</Button>
                  </div></>}
            </div>
          </div>
        )}
        {testResult && <Feedback tone={testResult === 'Face matched' ? 'success' : 'error'} title="Face verification">{testResult}</Feedback>}
        {notice && <Feedback tone="success" title="Face security update">{notice}</Feedback>}
        {error && <Feedback tone="error" title="Face security action failed">{error}</Feedback>}
        {status.data?.enrolled && !reenrolling && !testing && <div className="button-row">
          <Button variant="secondary" onClick={() => { setTesting(true); setTestResult(''); setError(''); setCameraError('') }}>Test verification</Button>
          <Button variant="secondary" onClick={() => { setReenrolling(true); setSamples([]); setError(''); setCameraError('') }}>Re-enrol</Button>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Delete enrolment</Button>
        </div>}
      </section>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete face enrolment?" description="You can enrol again at any time.">
        <div className="dialog-body"><Callout tone="warning" title="Face verification will no longer be available">Sensitive actions or sign-ins may require another verification method.</Callout><div className="dialog-actions"><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" loading={busy} onClick={() => void removeEnrollment()}>Delete enrolment</Button></div></div>
      </Dialog>
    </div>
  )
}

const profileSchema = z.object({ fullName: z.string().trim().min(1, 'Enter your name.').max(255, 'Name must be 255 characters or fewer.') })
const changePasswordSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: passwordRules })

export function ProfilePage() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmDevice, setConfirmDevice] = useState<Device | null>(null)
  const [trustDevice, setTrustDevice] = useState<Device | null>(null)
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => getData<Profile>('/users/me') })
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const currentDeviceHash = await getDeviceHash()
      return getData<Device[]>('/devices', { headers: { 'X-Device-Hash': currentDeviceHash } })
    },
  })
  const profileForm = useForm({ resolver: zodResolver(profileSchema), defaultValues: { fullName: '' } })
  const passwordForm = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } })

  useEffect(() => { if (profile.data) profileForm.reset({ fullName: profile.data.fullName }) }, [profile.data, profileForm])

  const updateProfile = profileForm.handleSubmit(async (values) => {
    setError('')
    try {
      await putData('/users/me', values)
      setNotice('Profile details saved.')
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  })

  const changePassword = passwordForm.handleSubmit(async (values) => {
    setError('')
    try {
      await sendData('/auth/change-password', values)
      setNotice('Password changed. Other refresh sessions have been revoked.')
      passwordForm.reset()
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  })

  const deviceAction = async (device: Device, action: 'trust' | 'revoke') => {
    setError('')
    try {
      if (action === 'trust') {
        await sendData(`/devices/${device.id}/trust`)
        setNotice('Device marked as trusted.')
      } else {
        await deleteData(`/devices/${device.id}`)
        setConfirmDevice(null)
        setNotice('Device access revoked.')
      }
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  }

  if (profile.isLoading || devices.isLoading) return <Skeleton lines={8} />
  if (profile.isError) return <PageError error={profile.error} />
  if (devices.isError) return <PageError error={devices.error} />
  if (!profile.data) return <Skeleton lines={8} />

  return (
    <div className="page-stack">
      <SectionHeading title="Profile and Devices" description="Manage your personal information, password and recognized devices." />
      {notice && <Feedback tone="success" title="Update complete">{notice}</Feedback>}
      {error && <Feedback tone="error" title="Update failed">{error}</Feedback>}
      <div className="content-grid">
        <section className="panel">
          <div className="profile-identity">
            <AvatarUploader
              name={profile.data.fullName}
              label={`Profile photo for ${profile.data.fullName}`}
              path={`/users/${profile.data.id}/avatar`}
              version={profile.data.avatarVersion ?? null}
              size={96}
              editable
              onUpload={async (image) => {
                const version = await uploadImage('/users/me/avatar', image)
                await queryClient.invalidateQueries({ queryKey: ['profile'] })
                return version
              }}
              onRemove={async () => {
                await removeImage('/users/me/avatar')
                await queryClient.invalidateQueries({ queryKey: ['profile'] })
              }}
            />
            <div><h2>{profile.data.fullName}</h2><p className="panel-intro">Profile photo and account details.</p></div>
          </div>
          <p className="panel-intro">Email address is assigned to your account.</p>
          <form className="stack" onSubmit={(event) => void updateProfile(event)}>
            <Input id="profileName" label="Full name" error={profileForm.formState.errors.fullName?.message} {...profileForm.register('fullName')} />
            <Input id="profileEmail" label="Email address" value={profile.data?.email ?? ''} disabled />
            <Button type="submit" loading={profileForm.formState.isSubmitting}>Save profile</Button>
          </form>
        </section>
        <section className="panel">
          <h2>Change password</h2>
          <p className="panel-intro">You’ll need your current password to continue.</p>
          <form className="stack" onSubmit={(event) => void changePassword(event)}>
            <Input id="currentPassword" label="Current password" type="password" autoComplete="current-password" error={passwordForm.formState.errors.currentPassword?.message} {...passwordForm.register('currentPassword')} />
            <Input id="changeNewPassword" label="New password" type="password" autoComplete="new-password" error={passwordForm.formState.errors.newPassword?.message} {...passwordForm.register('newPassword')} />
            <PasswordHints />
            <Button type="submit" loading={passwordForm.formState.isSubmitting}>Update password</Button>
          </form>
        </section>
      </div>
      <section className="panel">
        <SectionHeading title="Trusted devices" description="Review devices that have signed in to your account." />
        {(devices.data ?? []).length === 0 ? <EmptyState title="No recognized devices" description="Devices will appear here after you sign in." /> : (
          <DataTable>
            <thead><tr><th scope="col">Device</th><th scope="col">Last seen</th><th scope="col">Masked IP</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
            <tbody>{devices.data?.map((device) => <tr key={device.id}>
              <td><strong>{device.deviceName || 'Browser device'}</strong>{device.current && <span className="device-current"><Badge tone="warning">This device</Badge></span>}</td>
              <td>{formatTimestamp(device.lastSeen)}</td><td>{device.maskedIp ?? 'Not available'}</td>
              <td><Badge>{device.trusted ? 'Trusted' : 'Untrusted'}</Badge></td>
              <td className="table-actions">{device.current
                ? <Button variant="secondary" disabled title="You cannot revoke the device you are using">Revoke</Button>
                : device.trusted ? <Button variant="destructive" onClick={() => setConfirmDevice(device)}>Revoke</Button>
                  : <Button variant="secondary" onClick={() => setTrustDevice(device)}>Trust device</Button>}</td>
            </tr>)}</tbody>
          </DataTable>
        )}
      </section>
      <Dialog open={Boolean(confirmDevice)} onOpenChange={(open) => { if (!open) setConfirmDevice(null) }} title="Revoke device access?" description="This device will need to sign in again.">
        <div className="dialog-body"><Callout title="Device access will end">{confirmDevice?.deviceName || 'This browser device'} will be removed from your recognized devices.</Callout><div className="dialog-actions"><Button variant="secondary" onClick={() => setConfirmDevice(null)}>Cancel</Button><Button variant="destructive" onClick={() => confirmDevice && void deviceAction(confirmDevice, 'revoke')}>Revoke access</Button></div></div>
      </Dialog>
      <Dialog open={Boolean(trustDevice)} onOpenChange={(open) => { if (!open) setTrustDevice(null) }} title="Trust this device?" description="Trusted devices can reduce extra checks during future sign-ins.">
        <div className="dialog-body"><Callout title="Only trust a device you control">{trustDevice?.deviceName || 'This browser device'} will be marked as trusted for your account.</Callout><div className="dialog-actions"><Button variant="secondary" onClick={() => setTrustDevice(null)}>Cancel</Button><Button onClick={() => { if (trustDevice) void deviceAction(trustDevice, 'trust'); setTrustDevice(null) }}>Trust device</Button></div></div>
      </Dialog>
    </div>
  )
}

function PasswordHints() {
  return <p className="field-helper">12–72 characters with uppercase, lowercase, a number, a symbol and no whitespace.</p>
}

const orgSchema = z.object({
  name: z.string().trim().min(1, 'Enter an organization name.').max(255),
  logoUrl: z.string().max(1000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter uppercase currency code.'),
  taxSettings: z.string().max(10000).optional(),
})

export function OrganizationPage() {
  const queryClient = useQueryClient()
  const requestStepUp = useStepUp()
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => getData<Profile>('/users/me'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const invitationsQuery = useQuery({
    queryKey: ['invitations'],
    queryFn: () => getData<OrganizationInvitation[]>('/users/me/invitations'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const activeOrgId = useActiveOrganizationId()
  const memberships = profile.data?.memberships?.filter((membership) => membership.status === 'ACTIVE') ?? []
  const selectedMembership = memberships.find((membership) => String(membership.organizationId) === activeOrgId)
  const currentMembership = selectedMembership
  const currentOrgId = activeOrgId
  const isAdmin = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ORG_ADMIN'
  const orgQuery = useQuery({
    queryKey: ['organization', currentOrgId],
    queryFn: () => getData<Organization>('/organizations/current'),
    enabled: Boolean(currentOrgId),
  })
  const membersQuery = useQuery({
    queryKey: ['members', currentOrgId],
    queryFn: () => getData<Member[]>('/organizations/members'),
    enabled: isAdmin && Boolean(currentOrgId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [bankDetails, setBankDetails] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [bankDialogOpen, setBankDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('STAFF')
  const [inviteClientId, setInviteClientId] = useState('')
  const [selectedSearchResult, setSelectedSearchResult] = useState<MemberSearchResult | null>(null)
  const [memberSearchOpen, setMemberSearchOpen] = useState(false)
  const [activeSearchOption, setActiveSearchOption] = useState(0)
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState('')
  const inviteSearchRef = useRef<HTMLInputElement>(null)
  const inviteRoleRef = useRef<HTMLSelectElement>(null)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [memberAction, setMemberAction] = useState<'role' | 'remove' | null>(null)
  const [newRole, setNewRole] = useState<OrgRole>('STAFF')
  const [newAdminId, setNewAdminId] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newOrganizationName, setNewOrganizationName] = useState('')
  const [creatingOrganization, setCreatingOrganization] = useState(false)
  const [busyMemberId, setBusyMemberId] = useState<number | null>(null)
  const settingsForm = useForm<z.infer<typeof orgSchema>>({ resolver: zodResolver(orgSchema), defaultValues: { name: '', logoUrl: '', currency: 'USD', taxSettings: '' } })
  const memberSearchQuery = useQuery({
    queryKey: ['member-search', currentOrgId, debouncedMemberSearch],
    queryFn: () => getData<MemberSearchResult[]>(
      `/organizations/members/search?q=${encodeURIComponent(debouncedMemberSearch)}`),
    enabled: inviteOpen && isAdmin && Boolean(currentOrgId) && debouncedMemberSearch.length >= 3,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (!inviteOpen || selectedSearchResult || inviteEmail.length < 3) {
      setDebouncedMemberSearch('')
      return
    }
    const timer = window.setTimeout(() => setDebouncedMemberSearch(inviteEmail), 300)
    return () => window.clearTimeout(timer)
  }, [inviteOpen, inviteEmail, selectedSearchResult])

  useEffect(() => {
    if (!inviteOpen) {
      setInviteEmail('')
      setInviteName('')
      setInviteClientId('')
      setSelectedSearchResult(null)
      setMemberSearchOpen(false)
      setDebouncedMemberSearch('')
      setActiveSearchOption(0)
      queryClient.removeQueries({ queryKey: ['member-search', currentOrgId] })
    }
  }, [inviteOpen, currentOrgId, queryClient])

  useEffect(() => {
    if (orgQuery.data) settingsForm.reset({
      name: orgQuery.data.name,
      logoUrl: orgQuery.data.logoUrl ?? '',
      currency: orgQuery.data.currency,
      taxSettings: orgQuery.data.taxSettings ?? '',
    })
  }, [orgQuery.data, settingsForm])

  const saveSettings = settingsForm.handleSubmit(async (values) => {
    setError('')
    try {
      await putData('/organizations/current', { ...values, logoUrl: values.logoUrl || null, taxSettings: values.taxSettings || null })
      setNotice('Organization settings saved.')
      await queryClient.invalidateQueries({ queryKey: ['organization'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  })

  const createOrganization = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setCreatingOrganization(true)
    try {
      const created = await sendData<Organization>('/organizations', { name: newOrganizationName.trim(), currency: 'USD' })
      setNewOrganizationName('')
      setCreateOpen(false)
      setNotice('Organization created.')
      await queryClient.invalidateQueries()
      setActiveOrganizationId(created.id)
    } catch (reason) {
      setError(getApiError(reason).message)
    } finally {
      setCreatingOrganization(false)
    }
  }

  const workInOrganization = (organizationId: number) => {
    setActiveOrganizationId(organizationId)
    void queryClient.invalidateQueries()
  }

  const validInviteEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)
  const searchResults = memberSearchQuery.data ?? []
  const canOfferEmailInvite = inviteOpen && !selectedSearchResult && debouncedMemberSearch === inviteEmail
    && !memberSearchQuery.isLoading && !memberSearchQuery.isError && searchResults.length === 0 && validInviteEmail
  const enabledSearchOptions = searchResults
    .map((result, index) => result.state === 'AVAILABLE' ? index : -1)
    .filter((index) => index >= 0)
  if (canOfferEmailInvite) enabledSearchOptions.push(searchResults.length)

  const selectSearchResult = (result: MemberSearchResult) => {
    if (result.state !== 'AVAILABLE') return
    setSelectedSearchResult(result)
    setInviteEmail(result.email)
    setInviteName(result.fullName)
    setMemberSearchOpen(false)
    setDebouncedMemberSearch('')
    requestAnimationFrame(() => inviteRoleRef.current?.focus())
  }

  const chooseEmailInvite = () => {
    setInviteEmail(inviteEmail.trim())
    setInviteName('')
    setSelectedSearchResult(null)
    setMemberSearchOpen(false)
    requestAnimationFrame(() => document.getElementById('inviteName')?.focus())
  }

  const handleInviteSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setMemberSearchOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (enabledSearchOptions.length === 0) return
      event.preventDefault()
      setMemberSearchOpen(true)
      const currentIndex = enabledSearchOptions.indexOf(activeSearchOption)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const next = enabledSearchOptions[(currentIndex + direction + enabledSearchOptions.length) % enabledSearchOptions.length]
      setActiveSearchOption(next)
      return
    }
    if (event.key === 'Enter' && memberSearchOpen && enabledSearchOptions.includes(activeSearchOption)) {
      event.preventDefault()
      if (activeSearchOption === searchResults.length) chooseEmailInvite()
      else if (searchResults[activeSearchOption]) selectSearchResult(searchResults[activeSearchOption])
    }
  }

  const memberSearchError = memberSearchQuery.isError
    ? getApiError(memberSearchQuery.error)
    : null
  const memberSearchErrorMessage = memberSearchError
    ? memberSearchError.status === 429
      ? 'Too many searches, try again in a moment.'
      : memberSearchError.status === 403
        ? 'You do not have permission to search accounts in this organization.'
        : memberSearchError.status === 404
          ? 'Account search is unavailable. You can still invite by email.'
          : memberSearchError.status === undefined
            ? 'Search is temporarily unavailable. You can still invite by email.'
            : memberSearchError.message
    : null

  const uploadOrganizationLogo = async (image: Blob) => {
    const version = await uploadImage('/organizations/current/logo', image)
    await queryClient.invalidateQueries({ queryKey: ['profile'] })
    await queryClient.invalidateQueries({ queryKey: ['organization'] })
    return version
  }

  const removeOrganizationLogo = async () => {
    await removeImage('/organizations/current/logo')
    await queryClient.invalidateQueries({ queryKey: ['profile'] })
    await queryClient.invalidateQueries({ queryKey: ['organization'] })
  }

  const saveBankDetails = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const token = await requestStepUp('CHANGE_BANK_DETAILS', 'Confirm your identity before changing protected bank details.')
    if (!token) return
    try {
      await putData('/organizations/bank-details', { details: bankDetails }, { headers: { 'X-StepUp-Token': token } })
      setNotice('Protected bank details updated.')
      setBankDetails('')
      setBankDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['organization'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  }

  const inviteMember = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await sendData('/organizations/members', {
        email: inviteEmail,
        fullName: inviteName,
        role: inviteRole,
        clientId: inviteRole === 'CLIENT' ? Number(inviteClientId) : null,
      })
      setInviteOpen(false)
      setNotice('Invitation sent.')
      await queryClient.invalidateQueries({ queryKey: ['members'] })
      await queryClient.invalidateQueries({ queryKey: ['invitations'] })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  }

  const resendMemberInvitation = async (member: Member) => {
    setBusyMemberId(member.userId)
    setError('')
    try {
      await sendData(`/organizations/members/${member.userId}/resend-invitation`, {})
      setNotice('Invitation resent.')
      await queryClient.invalidateQueries({ queryKey: ['members'] })
    } catch (reason) {
      setError(getApiError(reason).message)
    } finally {
      setBusyMemberId(null)
    }
  }

  const updateRoleOrRemove = async () => {
    if (!selectedMember || !memberAction) return
    setError('')
    try {
      if (memberAction === 'role') await putData(`/organizations/members/${selectedMember.userId}/role`, { role: newRole })
      else if (selectedMember.status === 'INVITED') {
        await sendData(`/organizations/members/${selectedMember.userId}/revoke-invitation`, {})
      } else await deleteData(`/organizations/members/${selectedMember.userId}`)
      setNotice(memberAction === 'role' ? 'Member role updated.' : selectedMember.status === 'INVITED' ? 'Invitation revoked.' : 'Member removed.')
      setSelectedMember(null)
      setMemberAction(null)
      await queryClient.invalidateQueries({ queryKey: ['members'] })
      await queryClient.invalidateQueries({ queryKey: ['invitations'] })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  }

  const transferAdmin = async (event: React.FormEvent) => {
    event.preventDefault()
    const targetId = Number(newAdminId)
    if (!Number.isFinite(targetId)) return
    setError('')
    const token = await requestStepUp('CHANGE_ORGANIZATION_ADMIN', 'Confirm your identity before transferring organization administration.')
    if (!token) return
    try {
      await sendData('/organizations/transfer-admin', { newAdminUserId: targetId }, { headers: { 'X-StepUp-Token': token } })
      setTransferOpen(false)
      setNotice('Organization administrator role transferred.')
      await queryClient.invalidateQueries({ queryKey: ['members'] })
    } catch (reason) {
      const parsed = getApiError(reason)
      setError(parsed.message)
      if (parsed.status === 403) window.location.assign('/forbidden')
    }
  }

  if (profile.isLoading || (currentOrgId !== null && orgQuery.isLoading) || (isAdmin && membersQuery.isLoading)) return <Skeleton lines={8} />
  if (profile.isError) return <PageError error={profile.error} />
  if (currentOrgId && orgQuery.isError) return <PageError error={orgQuery.error} />
  if (isAdmin && membersQuery.isError && getApiError(membersQuery.error).status === 403) {
    return <div className="page-stack"><SectionHeading title="Organization" /><Callout tone="danger" title="Forbidden">The server denied access to organization member management.</Callout></div>
  }
  const members = membersQuery.data ?? []
  const pendingInvitations = invitationsQuery.data ?? []
  const pendingInvitationCount = profile.data?.pendingInvitationCount ?? pendingInvitations.length
  const ownerMemberships = memberships.filter((membership) => membership.type === 'OWNER' || membership.role === 'OWNER' || membership.role === 'ORG_ADMIN')
  const otherMemberships = memberships.filter((membership) => !ownerMemberships.includes(membership))

  return (
    <div className="page-stack">
      <SectionHeading title="Organization" description="Manage your organizations and review your access elsewhere." action={<Button invite onClick={() => setCreateOpen(true)}>Create organization</Button>} />
      {pendingInvitationCount > 0 && <div className="pending-invitation-notice" role="status" aria-live="polite">
        You have {pendingInvitationCount} pending invitation{pendingInvitationCount === 1 ? '' : 's'}.
      </div>}
      {notice && <Feedback tone="success" title="Update complete">{notice}</Feedback>}
      {error && <Feedback tone="error" title="Update failed">{error}</Feedback>}
      {membersQuery.isError && <PageError error={membersQuery.error} title="Members are unavailable" />}
      <section className="panel">
        <div className="panel-title-row"><div><h2>My organizations</h2><p>Organizations where you are the Business Owner.</p></div></div>
        {ownerMemberships.length === 0 ? <EmptyState title="No organizations you own" description="Organizations where you have another role appear below. You can also create an organization." />
          : <div className="organization-list">{ownerMemberships.map((membership) => (
            <article className="organization-card" key={membership.organizationId}>
              <div className="organization-card-heading">
                {String(membership.organizationId) === currentOrgId && isAdmin
                  ? <AvatarUploader
                    name={membership.name}
                    label={`${membership.name} logo`}
                    path={`/organizations/${membership.organizationId}/logo`}
                    version={membership.logoVersion}
                    size={40}
                    editable
                    onUpload={uploadOrganizationLogo}
                    onRemove={removeOrganizationLogo}
                  />
                  : <Avatar name={membership.name} path={`/organizations/${membership.organizationId}/logo`} version={membership.logoVersion} size={40} alt={`${membership.name} logo`} />}
                <strong>{membership.name}</strong><Badge>Business Owner</Badge>
              </div>
              <Button variant="secondary" disabled={String(membership.organizationId) === currentOrgId} onClick={() => workInOrganization(membership.organizationId)}>
                {String(membership.organizationId) === currentOrgId ? 'Working here' : 'Work in this organization'}
              </Button>
            </article>
          ))}</div>}
      </section>
      <section className="panel">
        <div className="panel-title-row"><div><h2>Other organizations</h2><p>Your read-only organization access and effective permissions.</p></div></div>
        {invitationsQuery.isError && <PageError error={invitationsQuery.error} title="Invitations are unavailable" />}
        {invitationsQuery.isLoading && otherMemberships.length === 0
          ? <Skeleton lines={2} />
          : otherMemberships.length === 0 && pendingInvitations.length === 0 && invitationsQuery.isSuccess
          ? <EmptyState title="No other organizations" description="Organizations where you are an Accountant, Staff member, Viewer or Client will appear here." />
          : <div className="organization-list">
            {pendingInvitations.map((invitation) => <InvitationCard key={invitation.invitationId} invitation={invitation} />)}
            {otherMemberships.map((membership) => {
            const isClient = membership.type === 'CLIENT' || membership.role === 'CLIENT'
            const isCurrent = String(membership.organizationId) === currentOrgId
            const allowed = membership.permissions.map((permission) => permissionLabels[permission] ?? permission.replaceAll('_', ' ').toLowerCase())
            return (
              <article className="organization-card" key={membership.organizationId}>
                <div className="organization-card-heading">
                  <Avatar name={membership.name} path={`/organizations/${membership.organizationId}/logo`} version={membership.logoVersion} size={40} alt={`${membership.name} logo`} />
                  <strong>{membership.name}</strong>
                  <Badge>{isClient ? 'Client' : membership.role === 'OWNER' ? 'Business Owner' : membership.role.replaceAll('_', ' ')}</Badge>
                </div>
                <p>{allowed.length ? `Your permissions: ${allowed.join(', ')}.` : 'No organization permissions are assigned.'}</p>
                <Button variant="secondary" disabled={isCurrent} onClick={() => workInOrganization(membership.organizationId)}>
                  {isCurrent ? 'Working here' : 'Work in this organization'}
                </Button>
              </article>
            )
            })}
          </div>}
      </section>
      {isAdmin && orgQuery.data && <section className="panel">
        <div className="panel-title-row"><div><h2>Organization settings</h2><p>Settings apply to this organization workspace.</p></div>{!isAdmin && <Badge>Read only</Badge>}</div>
        <form className="form-grid" onSubmit={(event) => void saveSettings(event)}>
          <Input id="orgName" label="Organization name" disabled={!isAdmin} error={settingsForm.formState.errors.name?.message} {...settingsForm.register('name')} />
          <Input id="orgLogo" label="Logo URL" type="url" disabled={!isAdmin} error={settingsForm.formState.errors.logoUrl?.message} {...settingsForm.register('logoUrl')} />
          <Input id="orgCurrency" label="Currency" maxLength={3} disabled={!isAdmin} error={settingsForm.formState.errors.currency?.message} {...settingsForm.register('currency')} />
          <div className="field form-span"><label htmlFor="taxSettings">Tax settings</label><textarea id="taxSettings" className="input textarea" disabled={!isAdmin} aria-describedby="taxSettings-help" {...settingsForm.register('taxSettings')} /><p id="taxSettings-help" className="field-helper">Optional text or JSON value accepted by the organization API.</p></div>
          {isAdmin && <div className="form-span"><Button type="submit" loading={settingsForm.formState.isSubmitting}>Save organization settings</Button></div>}
        </form>
      </section>}
      {isAdmin && orgQuery.data && <section className="panel">
        <h2>Bank details</h2>
        <p className="panel-intro">Current saved details: <strong>{orgQuery.data?.maskedBankDetails ?? 'No saved details'}</strong></p>
        {isAdmin ? <Button variant="secondary" onClick={() => setBankDialogOpen(true)}>Edit bank details</Button> : <Badge>Read only</Badge>}
      </section>}
      {isAdmin && orgQuery.data && <section className="panel">
        <SectionHeading title="Members" description="People who can access this organization." action={isAdmin ? <Button invite onClick={() => setInviteOpen(true)}>Invite member</Button> : <Badge>Read only</Badge>} />
        {isAdmin ? members.length === 0 ? <EmptyState title="No members found" description="Invite people to collaborate in this workspace." /> : (
          <DataTable>
            <thead><tr><th scope="col">Member</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
            <tbody>{members.map((member) => {
              const displayName = member.fullName ?? member.email
              return <tr key={member.userId}>
                <td className="member-name"><Avatar name={displayName} path={`/users/${member.userId}/avatar`} version={member.avatarVersion ?? null} size={24} alt={`Photo of ${displayName}`} /><strong>{displayName}</strong></td><td>{member.email}</td><td>{member.role.replace('_', ' ')}</td><td><Badge>{memberStatusLabel(member.status)}</Badge></td>
                <td className="table-actions">{member.status === 'INVITED' && <><button className="text-action" disabled={busyMemberId === member.userId} onClick={() => void resendMemberInvitation(member)}>{busyMemberId === member.userId ? 'Resending…' : 'Resend invite'}</button><button className="text-action danger-action" onClick={() => { setSelectedMember(member); setMemberAction('remove') }}>Revoke invite</button></>}<button className="text-action" onClick={() => { setSelectedMember(member); setNewRole(member.role); setMemberAction('role') }}>Manage role</button>{member.status !== 'INVITED' && <button className="text-action danger-action" onClick={() => { setSelectedMember(member); setMemberAction('remove') }}>Remove</button>}</td>
              </tr>
            })}</tbody>
          </DataTable>
        ) : <p className="muted-copy">Member details are available to organization administrators.</p>}
      </section>}
      {isAdmin && <>
        <section className="panel transfer-panel">
          <div><h2>Transfer admin</h2><p>Transfer organization administration to another active member. Fresh face verification is required.</p></div>
          <Button variant="secondary" onClick={() => setTransferOpen(true)}>Transfer admin</Button>
        </section>
      </>}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Create organization" description="Create a workspace that you own.">
        <form className="dialog-body" onSubmit={(event) => void createOrganization(event)}>
          <Input id="newOrganizationName" label="Organization name" required maxLength={255} value={newOrganizationName} onChange={(event) => setNewOrganizationName(event.target.value)} />
          <p className="field-helper">The default currency is USD. You can update organization settings after creation.</p>
          <div className="dialog-actions">
            <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" loading={creatingOrganization} disabled={!newOrganizationName.trim()}>Create organization</Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Invite member" description="Send an invitation to join this organization.">
        <form className="dialog-body stack" onSubmit={(event) => void inviteMember(event)}>
          {!selectedSearchResult && <Input id="inviteName" label="Full name" required value={inviteName} onChange={(event) => setInviteName(event.target.value)} />}
          <div className="field member-search-field">
            <label htmlFor="inviteEmail">Email address</label>
            <input
              ref={inviteSearchRef}
              id="inviteEmail"
              type="email"
              className="input"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={memberSearchOpen && inviteEmail.length >= 3 && !selectedSearchResult}
              aria-controls="member-search-options"
              aria-activedescendant={memberSearchOpen && enabledSearchOptions.includes(activeSearchOption)
                ? `member-search-option-${activeSearchOption}` : undefined}
              autoComplete="email"
              required
              value={inviteEmail}
              onFocus={() => {
                if (inviteEmail.length >= 3 && !selectedSearchResult) setMemberSearchOpen(true)
              }}
              onChange={(event) => {
                setInviteEmail(event.target.value)
                setInviteName('')
                setSelectedSearchResult(null)
                setMemberSearchOpen(true)
                setActiveSearchOption(0)
              }}
              onKeyDown={handleInviteSearchKeyDown}
            />
            {selectedSearchResult && <div className="member-search-selected">
              <Avatar name={selectedSearchResult.fullName} imageData={selectedSearchResult.avatarThumbnail} size={32} alt="" />
              <span><strong>{selectedSearchResult.fullName}</strong><small>{selectedSearchResult.email}</small></span>
              <button type="button" className="icon-button" aria-label="Clear selected account" onClick={() => {
                setSelectedSearchResult(null)
                setInviteEmail('')
                setInviteName('')
                setDebouncedMemberSearch('')
                requestAnimationFrame(() => inviteSearchRef.current?.focus())
              }}><X size={16} /></button>
            </div>}
            {memberSearchOpen && inviteEmail.length >= 3 && !selectedSearchResult && <div className="member-search-options" id="member-search-options" role="listbox" aria-label="Matching accounts">
              {inviteEmail !== debouncedMemberSearch || memberSearchQuery.isLoading
                ? <div className="member-search-message" role="option" aria-disabled="true">Searching accounts…</div>
                : memberSearchErrorMessage
                  ? <div className="member-search-message" role="status">{memberSearchErrorMessage}</div>
                  : searchResults.map((result, index) => {
                    const isAvailable = result.state === 'AVAILABLE'
                    const stateLabel = result.state === 'ALREADY_MEMBER' ? 'Already a member'
                      : result.state === 'ALREADY_INVITED' ? 'Already invited' : 'Available'
                    return <button
                      type="button"
                      role="option"
                      id={`member-search-option-${index}`}
                      key={result.userId}
                      aria-selected={activeSearchOption === index}
                      aria-disabled={!isAvailable}
                      disabled={!isAvailable}
                      className="member-search-option"
                      onMouseEnter={() => setActiveSearchOption(index)}
                      onClick={() => selectSearchResult(result)}
                    >
                      <Avatar name={result.fullName} imageData={result.avatarThumbnail} size={32} alt="" />
                      <span className="member-search-result-details"><strong>{result.fullName}</strong><small>{highlightEmail(result.email, inviteEmail)}</small></span>
                      <Badge tone={isAvailable ? 'success' : 'neutral'}>{stateLabel}</Badge>
                    </button>
                  })}
              {canOfferEmailInvite && <button
                type="button"
                role="option"
                id={`member-search-option-${searchResults.length}`}
                aria-selected={activeSearchOption === searchResults.length}
                className="member-search-email-fallback"
                onMouseEnter={() => setActiveSearchOption(searchResults.length)}
                onClick={chooseEmailInvite}
              >
                No Olgax account found. Invite <strong>{inviteEmail}</strong> by email; they can create an account and join.
              </button>}
              {inviteEmail === debouncedMemberSearch && !memberSearchQuery.isLoading
                && !memberSearchQuery.isError && searchResults.length === 0 && !canOfferEmailInvite
                && <div className="member-search-message" role="option" aria-disabled="true">No matching accounts found.</div>}
            </div>}
          </div>
          <div className="field"><label htmlFor="inviteRole">Role</label><select ref={inviteRoleRef} id="inviteRole" className="input" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as OrgRole)}><option value="ACCOUNTANT">Accountant</option><option value="STAFF">Staff</option><option value="VIEWER">Viewer</option><option value="CLIENT">Client</option></select></div>
          {inviteRole === 'CLIENT' && <Input id="inviteClientId" label="Client ID" type="number" min={1} required value={inviteClientId} onChange={(event) => setInviteClientId(event.target.value)} />}
          <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button><Button invite type="submit" disabled={inviteRole === 'CLIENT' && (!inviteClientId || Number(inviteClientId) <= 0)}>Invite member</Button></div>
        </form>
      </Dialog>
      <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen} title="Edit bank details" description="Sensitive details are protected by a fresh face verification.">
        <form className="dialog-body" onSubmit={(event) => void saveBankDetails(event)}>
          <div className="field"><label htmlFor="bankDetails">New bank details</label><textarea id="bankDetails" className="input textarea" value={bankDetails} maxLength={3500} onChange={(event) => setBankDetails(event.target.value)} aria-describedby="bankDetails-help" /><p id="bankDetails-help" className="field-helper">Current bank details are masked and never prefilled.</p></div>
          <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setBankDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={!bankDetails.trim()}>Verify and update</Button></div>
        </form>
      </Dialog>
      <Dialog open={Boolean(selectedMember && memberAction)} onOpenChange={(open) => { if (!open) { setMemberAction(null); setSelectedMember(null) } }} title={memberAction === 'role' ? 'Manage member role' : selectedMember?.status === 'INVITED' ? 'Revoke invitation?' : 'Remove member?'} description={selectedMember ? `${selectedMember.fullName ?? selectedMember.email} · ${selectedMember.email}` : ''}>
        <div className="dialog-body">
          {memberAction === 'role' ? <div className="field"><label htmlFor="memberRole">Organization role</label><select id="memberRole" className="input" value={newRole} onChange={(event) => setNewRole(event.target.value as OrgRole)}><option value="ORG_ADMIN">Organization admin</option><option value="ACCOUNTANT">Accountant</option><option value="STAFF">Staff</option><option value="VIEWER">Viewer</option></select></div> : <Callout title={selectedMember?.status === 'INVITED' ? 'Pending invitation only' : 'Member access will end'}>{selectedMember?.status === 'INVITED' ? 'This removes the pending membership invitation. It does not change any active member access.' : 'This member will no longer have access to the organization.'}</Callout>}
          <div className="dialog-actions"><Button variant="secondary" onClick={() => { setMemberAction(null); setSelectedMember(null) }}>Cancel</Button><Button variant={memberAction === 'remove' ? 'destructive' : 'primary'} onClick={() => void updateRoleOrRemove()}>{memberAction === 'role' ? 'Save role' : selectedMember?.status === 'INVITED' ? 'Revoke invitation' : 'Remove member'}</Button></div>
        </div>
      </Dialog>
      <Dialog open={transferOpen} onOpenChange={setTransferOpen} title="Transfer organization admin?" description="This is a sensitive organization action.">
        <form className="dialog-body stack" onSubmit={(event) => void transferAdmin(event)}>
          <Callout title="Admin transfer requires fresh verification">Choose an active member. Once transferred, your role may change.</Callout>
          <div className="field"><label htmlFor="newAdmin">New administrator</label><select className="input" id="newAdmin" value={newAdminId} onChange={(event) => setNewAdminId(event.target.value)} required><option value="">Select a member</option>{members.filter((member) => member.status === 'ACTIVE' && member.role !== 'ORG_ADMIN').map((member) => <option key={member.userId} value={member.userId}>{member.fullName ?? member.email} · {member.email}</option>)}</select></div>
          <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setTransferOpen(false)}>Cancel</Button><Button type="submit" disabled={!newAdminId}>Verify and transfer</Button></div>
        </form>
      </Dialog>
    </div>
  )
}

export function AuditPageView() {
  const { role } = useAuth()
  const isAdmin = role === 'ORG_ADMIN' || role === 'SUPER_ADMIN'
  const [page, setPage] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [verificationResult, setVerificationResult] = useState('')
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [riskySelected, setRiskySelected] = useState<RiskyLogin | null>(null)
  const params = useMemo(() => {
    const search = new URLSearchParams({ page: String(page), size: '20' })
    if (from) search.set('from', `${from}T00:00:00`)
    if (to) search.set('to', `${to}T23:59:59`)
    if (userId) search.set('userId', userId)
    if (action) search.set('action', action)
    if (verificationResult) search.set('verificationResult', verificationResult)
    return search.toString()
  }, [action, from, page, to, userId, verificationResult])
  const summary = useQuery({ queryKey: ['security-summary'], queryFn: () => getData<DashboardSummary>('/security/dashboard-summary'), enabled: isAdmin })
  const risky = useQuery({ queryKey: ['risky-logins'], queryFn: () => getData<RiskyLogin[]>('/security/risky-logins?page=0&size=10'), enabled: isAdmin })
  const logs = useQuery({ queryKey: ['audit-logs', params], queryFn: () => getData<AuditPage>(`/audit-logs?${params}`), enabled: isAdmin })

  if (!isAdmin) return <div className="page-stack"><SectionHeading title="Security Audit" /><Callout tone="danger" title="Forbidden">Security audit information is available to organization administrators only.</Callout></div>
  if (summary.isLoading || risky.isLoading || logs.isLoading) return <Skeleton lines={9} />
  const denied = [summary.error, risky.error, logs.error].some((error) => error && getApiError(error).status === 403)
  if (denied) return <div className="page-stack"><SectionHeading title="Security Audit" /><Callout tone="danger" title="Forbidden">The server denied access to the security audit data.</Callout></div>

  const clearFilters = () => { setFrom(''); setTo(''); setUserId(''); setAction(''); setVerificationResult(''); setPage(0) }
  const totalPages = Math.max(1, Math.ceil((logs.data?.totalElements ?? 0) / (logs.data?.size ?? 20)))

  return (
    <div className="page-stack">
      <SectionHeading title="Security Audit" description="Review sign-in and sensitive-action activity for your organization." />
      {summary.isError && <PageError error={summary.error} title="Dashboard summary is unavailable" />}
      {risky.isError && <PageError error={risky.error} title="Risky sign-ins are unavailable" />}
      {logs.isError && <PageError error={logs.error} title="Audit log is unavailable" />}
      {summary.data && <div className="metric-grid audit-metrics">
        <MetricCard label="Logins per day" value={summary.data.loginsPerDay.reduce((sum, item) => sum + item.total, 0)} context="Last 7 days" />
        <MetricCard label="Failed logins" value={summary.data.failedLogins} context="Last 7 days" badge={<Badge tone="danger">Review</Badge>} />
        <MetricCard label="Face verification success" value={`${Math.round(summary.data.faceVerificationSuccessRate)}%`} context="Reported by API" />
        <MetricCard label="High-risk logins" value={summary.data.highRiskLogins} context="Last 7 days" badge={<Badge tone="warning">Review</Badge>} />
        <MetricCard label="Step-up checks" value={summary.data.stepUpCount} context="Last 7 days" />
      </div>}
      {summary.data && <section className="panel">
        <h2>Login activity</h2>
        <div className="chart-container"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.data.loginsPerDay}>
          <CartesianGrid stroke="#DCE3ED" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(value: string) => value.slice(5)} tick={{ fill: '#627187', fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fill: '#627187', fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="total" name="Logins" fill="#142B4D" radius={[4, 4, 0, 0]} />
          <Bar dataKey="failed" name="Failed" fill="#B53D3D" radius={[4, 4, 0, 0]} />
        </BarChart></ResponsiveContainer></div>
      </section>}
      {summary.data && <div className="content-grid">
        <section className="panel"><h2>Top risky users</h2>{summary.data.topRiskyUsers.length ? <DataTable><thead><tr><th scope="col">User</th><th scope="col">Failed attempts</th><th scope="col">Highest risk</th></tr></thead><tbody>{summary.data.topRiskyUsers.map((user) => <tr key={user.userId}><td>{user.email}</td><td>{user.failedAttempts}</td><td><Badge tone="warning">{user.maxRiskScore}</Badge></td></tr>)}</tbody></DataTable> : <EmptyState title="No users to review" description="Risk indicators will appear here when available." />}</section>
        <section className="panel"><h2>Top risky devices</h2>{summary.data.topRiskyDevices.length ? <DataTable><thead><tr><th scope="col">Device</th><th scope="col">Attempts</th><th scope="col">Highest risk</th></tr></thead><tbody>{summary.data.topRiskyDevices.map((device, index) => <tr key={`${index}-${device.attempts}`}><td>Device {index + 1}</td><td>{device.attempts}</td><td><Badge tone="warning">{device.maxRiskScore}</Badge></td></tr>)}</tbody></DataTable> : <EmptyState title="No devices to review" description="Device identifiers are not displayed in this dashboard." />}</section>
      </div>}
      <section className="panel">
        <h2>Risky sign-ins</h2>
        {(risky.data ?? []).length === 0 ? <EmptyState title="No risky sign-ins" description="No sign-ins are currently marked for review." /> : <DataTable>
          <thead><tr><th scope="col">User</th><th scope="col">Risk score</th><th scope="col">Reason</th><th scope="col">Outcome</th><th scope="col">Time</th><th scope="col">Details</th></tr></thead>
          <tbody>{risky.data?.map((entry, index) => <tr key={`${entry.email}-${entry.timestamp}-${index}`}><td>{entry.email}</td><td><Badge tone="warning">{entry.riskScore}</Badge></td><td>{entry.riskReasons}</td><td>{entry.outcome}</td><td>{formatTimestamp(entry.timestamp)}</td><td><button className="text-action" onClick={() => setRiskySelected(entry)}>View details</button></td></tr>)}</tbody>
        </DataTable>}
      </section>
      <section className="panel">
        <div className="panel-title-row"><div><h2>Audit log</h2><p>Filter and inspect organization events.</p></div><span className="caption">{logs.data?.totalElements ?? 0} events</span></div>
        <div className="audit-filters">
          <Input id="filterFrom" label="From" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0) }} />
          <Input id="filterTo" label="To" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0) }} />
          <Input id="filterUser" label="User ID" inputMode="numeric" value={userId} onChange={(event) => { setUserId(event.target.value.replace(/\D/g, '')); setPage(0) }} />
          <Input id="filterAction" label="Action" value={action} onChange={(event) => { setAction(event.target.value); setPage(0) }} />
          <div className="field"><label htmlFor="filterResult">Result</label><select id="filterResult" className="input" value={verificationResult} onChange={(event) => { setVerificationResult(event.target.value); setPage(0) }}><option value="">All results</option><option value="SUCCESS">Success</option><option value="FAILED">Failed</option></select></div>
          <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
        </div>
        {(logs.data?.content ?? []).length === 0 ? <EmptyState description="Clear a filter or choose a wider date range to see more activity." onClear={clearFilters} /> : <DataTable>
          <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Result</th><th scope="col">Risk score</th><th scope="col">Detail</th></tr></thead>
          <tbody>{logs.data?.content.map((entry) => <tr key={entry.id}><td>{formatTimestamp(entry.timestamp)}</td><td>{entry.actorId}</td><td>{entry.action}</td><td>{entry.verificationResult ?? '—'}</td><td>{entry.riskScore ?? '—'}</td><td><button className="text-action" onClick={() => setSelected(entry)}>View detail</button></td></tr>)}</tbody>
        </DataTable>}
        <div className="pagination"><span>Page {page + 1} of {totalPages}</span><div><Button variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button><Button variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
      </section>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} title="Audit log details" description={selected ? `${selected.action} · ${formatTimestamp(selected.timestamp)}` : ''} className="audit-drawer">
        {selected && <AuditDetails entry={selected} />}
      </Dialog>
      <Dialog open={Boolean(riskySelected)} onOpenChange={(open) => { if (!open) setRiskySelected(null) }} title="Risky sign-in details" description={riskySelected ? `${riskySelected.email} · ${formatTimestamp(riskySelected.timestamp)}` : ''}>
        {riskySelected && <div className="dialog-body"><dl className="detail-list"><div><dt>IP address</dt><dd>{riskySelected.ipAddress ?? 'Not available'}</dd></div><div><dt>Risk score</dt><dd>{riskySelected.riskScore}</dd></div><div><dt>Reasons</dt><dd>{riskySelected.riskReasons}</dd></div><div><dt>Outcome</dt><dd>{riskySelected.outcome}</dd></div></dl></div>}
      </Dialog>
    </div>
  )
}

function AuditDetails({ entry }: { entry: AuditEntry }) {
  return <div className="dialog-body"><dl className="detail-list">
    <div><dt>Actor ID</dt><dd>{entry.actorId}</dd></div><div><dt>IP address</dt><dd>{entry.ipAddress ?? 'Not available'}</dd></div>
    <div><dt>Device</dt><dd>{entry.device ?? 'Not available'}</dd></div><div><dt>Location</dt><dd>{entry.location ?? 'Not available'}</dd></div>
    <div><dt>Risk score</dt><dd>{entry.riskScore ?? 'Not available'}</dd></div><div><dt>Verification result</dt><dd>{entry.verificationResult ?? 'Not available'}</dd></div>
    <div className="detail-wide"><dt>Details</dt><dd><pre className="json-detail">{entry.details ?? 'No additional details were provided.'}</pre></dd></div>
  </dl></div>
}
