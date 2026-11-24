import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getData } from '../api/requests'
import { getApiError, riskReasonText } from '../api/errors'
import type { ActivityEntry, ActivityPage, SecuritySummary } from '../api/types'
import { Badge, Button, Callout, DataTable, Dialog, EmptyState, Feedback, Input, MetricCard, SectionHeading, Skeleton } from '../components/ui'
import { formatTimestamp } from '../utils/formatTimestamp'

const eventTypes = [
  'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGIN_CHALLENGE_CREATED', 'LOGIN_FACE_VERIFIED',
  'LOGIN_FACE_FAILED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'TOKEN_REFRESHED',
  'STEP_UP_SUCCEEDED', 'STEP_UP_FAILED', 'DEVICE_TRUSTED', 'DEVICE_REVOKED',
  'FACE_ENROLLED', 'FACE_ENROLLMENT_DELETED', 'LOGOUT', 'EMAIL_VERIFIED',
  'EMAIL_OTP_VERIFIED', 'FAILED_ATTEMPTS_THRESHOLD_REACHED', 'ACCOUNT_LOCKED',
  'AVATAR_UPLOADED', 'AVATAR_REMOVED', 'ORGANIZATION_LOGO_UPLOADED', 'ORGANIZATION_LOGO_REMOVED',
]

function localDateBound(date: string, endOfDay: boolean): string {
  const localDate = new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00'}`)
  return localDate.toISOString()
}

function resultTone(result: string): 'success' | 'danger' | 'neutral' {
  if (result === 'success') return 'success'
  if (result === 'failed') return 'danger'
  return 'neutral'
}

function riskTone(level: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (level === 'low') return 'success'
  if (level === 'medium') return 'warning'
  if (level === 'high') return 'danger'
  return 'neutral'
}

function riskReasonLabel(reason: string): string {
  if (reason.startsWith('NEW_COUNTRY:')) return `New country: ${reason.slice('NEW_COUNTRY:'.length)}`
  const labels: Record<string, string> = {
    NEW_CITY: 'New city',
    UNRECOGNIZED_DEVICE: 'New device',
    UNRECOGNIZED_IP: 'New network',
    UNUSUAL_LOGIN_TIME: 'Unusual time',
  }
  return labels[reason] ?? riskReasonText(reason)
}

export default function AuditLogPage() {
  const [page, setPage] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [eventType, setEventType] = useState('')
  const [result, setResult] = useState('')
  const [selected, setSelected] = useState<ActivityEntry | null>(null)

  const params = useMemo(() => {
    const search = new URLSearchParams({ page: String(page), size: '20' })
    if (from) search.set('from', localDateBound(from, false))
    if (to) search.set('to', localDateBound(to, true))
    if (eventType) search.set('eventType', eventType)
    if (result) search.set('result', result)
    return search.toString()
  }, [eventType, from, page, result, to])

  const summary = useQuery({
    queryKey: ['security-summary'],
    queryFn: () => getData<SecuritySummary>('/users/me/security-summary'),
  })
  const activity = useQuery({
    queryKey: ['my-activity', params],
    queryFn: () => getData<ActivityPage>(`/users/me/activity?${params}`),
  })

  const clearFilters = () => {
    setFrom('')
    setTo('')
    setEventType('')
    setResult('')
    setPage(0)
  }
  const hasFilters = Boolean(from || to || eventType || result)
  const totalPages = Math.max(1, Math.ceil((activity.data?.totalElements ?? 0) / (activity.data?.size ?? 20)))

  return (
    <div className="page-stack">
      <SectionHeading title="Audit log" description="Review the security activity and sign-in risk for your account." />
      {summary.isLoading ? <Skeleton lines={3} /> : summary.isError
        ? <Feedback tone="error" title="Security summary is unavailable">{getApiError(summary.error).message}</Feedback>
        : summary.data && (
          <>
            <div className="metric-grid audit-metrics">
              <MetricCard
                label="Last login"
                value={summary.data.lastSuccessfulLoginAt ? formatTimestamp(summary.data.lastSuccessfulLoginAt) : 'No successful login'}
                context={[summary.data.lastLoginLocation, summary.data.lastLoginDevice].filter(Boolean).join(' · ') || 'Account history'}
              />
              <MetricCard
                label="Latest risk score"
                value={summary.data.latestRiskScore ?? 'No recent score'}
                context="Most recent sign-in"
                badge={<Badge tone={riskTone(summary.data.latestRiskLevel)}>{summary.data.latestRiskLevel ?? 'Unknown'}</Badge>}
              />
              <MetricCard
                label="Face status"
                value={summary.data.faceEnrolled ? 'Enrolled' : 'Not enrolled'}
                context={`${summary.data.faceSampleCount} samples stored`}
                badge={<Badge tone={summary.data.faceEnrolled ? 'success' : 'neutral'}>{summary.data.faceEnrolled ? 'Active' : 'Optional'}</Badge>}
              />
              <MetricCard
                label="Trusted devices"
                value={summary.data.trustedDevicesCount}
                context={`${summary.data.failedAttemptsLast7Days} failed attempts in the last 7 days`}
              />
            </div>
            {!summary.data.faceEnrolled && (
              <Callout title="Enrol your face">
                Face verification adds protection to sign-ins and sensitive changes. <Link to="/face">Enrol your face</Link>
              </Callout>
            )}
          </>
        )}
      {!summary.isLoading && summary.data && !summary.data.faceEnrolled && (
        <div><Button onClick={() => window.location.assign('/face')}>Enrol your face</Button></div>
      )}
      <section className="panel">
        <div className="panel-title-row">
          <div><h2>Your security events</h2><p>This account-level log is independent of the selected organization.</p></div>
          <span className="caption">{activity.data?.totalElements ?? 0} events</span>
        </div>
        <div className="audit-filters">
          <Input id="activityFrom" label="From" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0) }} />
          <Input id="activityTo" label="To" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0) }} />
          <div className="field">
            <label htmlFor="activityEventType">Event type</label>
            <select id="activityEventType" className="input" value={eventType} onChange={(event) => { setEventType(event.target.value); setPage(0) }}>
              <option value="">All event types</option>
              {eventTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="activityResult">Result</label>
            <select id="activityResult" className="input" value={result} onChange={(event) => { setResult(event.target.value); setPage(0) }}>
              <option value="">All results</option><option value="success">Success</option><option value="failed">Failed</option><option value="not required">Not required</option>
            </select>
          </div>
          <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
        </div>
        {activity.isError ? <Feedback tone="error" title="Audit log is unavailable">{getApiError(activity.error).message}</Feedback>
          : activity.isLoading ? <Skeleton lines={5} />
            : activity.data?.content.length === 0 ? (
              hasFilters
                ? <EmptyState title="No events match these filters" description="Clear a filter or choose a wider date range to see more activity." onClear={clearFilters} />
                : <EmptyState title="No security activity yet" description="Security events for your account will appear here." />
            ) : (
              <DataTable>
                <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Result</th><th scope="col">Device</th><th scope="col">Risk score</th><th scope="col">Location</th></tr></thead>
                <tbody>{activity.data?.content.map((entry) => (
                  <tr
                    key={entry.id}
                    className="clickable-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${entry.eventType.replaceAll('_', ' ')} details`}
                    onClick={() => setSelected(entry)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                        keyboardEvent.preventDefault()
                        setSelected(entry)
                      }
                    }}
                  >
                    <td>{formatTimestamp(entry.time)}</td>
                    <td>{entry.eventType.replaceAll('_', ' ')}</td>
                    <td><Badge tone={resultTone(entry.result)}>{entry.result}</Badge></td>
                    <td>{entry.deviceLabel ?? 'Not available'}</td>
                    <td><Badge tone={riskTone(entry.riskLevel)}>{entry.riskScore} · {entry.riskLevel}</Badge></td>
                    <td>{entry.approximateLocation ?? 'Not available'}</td>
                  </tr>
                ))}</tbody>
              </DataTable>
            )}
        {!activity.isLoading && !activity.isError && (activity.data?.totalElements ?? 0) > 0 && (
          <div className="pagination">
            <span>Page {page + 1} of {totalPages}</span>
            <div>
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button>
              <Button variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        )}
      </section>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        title="Security event details"
        description={selected ? `${selected.eventType.replaceAll('_', ' ')} · ${formatTimestamp(selected.time)}` : ''}
        className="audit-drawer"
      >
        {selected && <div className="dialog-body"><dl className="detail-list">
          <div><dt>Result</dt><dd>{selected.result}</dd></div>
          <div><dt>IP address</dt><dd>{selected.maskedIp ?? 'Not available'}</dd></div>
          <div><dt>Device</dt><dd>{selected.deviceLabel ?? 'Not available'}</dd></div>
          <div><dt>Location</dt><dd>{selected.approximateLocation ?? 'Not available'}</dd></div>
          <div><dt>Risk score</dt><dd><Badge tone={riskTone(selected.riskLevel)}>{selected.riskScore} · {selected.riskLevel}</Badge></dd></div>
          <div><dt>Risk reasons</dt><dd className="button-row">{selected.riskReasons.length
            ? selected.riskReasons.map((reason) => <Badge key={reason} tone="warning">{riskReasonLabel(reason)}</Badge>)
            : 'None recorded'}</dd></div>
          <div><dt>Verification result</dt><dd>{selected.verificationResult ?? 'Not available'}</dd></div>
        </dl></div>}
      </Dialog>
    </div>
  )
}
