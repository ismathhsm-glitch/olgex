import {
  Building2, Check, ChevronDown, CircleUserRound, Fingerprint, LogOut, Menu, Search, ShieldCheck, X,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getData, sendData } from '../api/requests'
import { setActiveOrganizationId, useActiveOrganizationId } from '../api/organizationContext'
import { getRefreshToken } from '../api/client'
import { getApiError } from '../api/errors'
import type { Organization, Profile } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from './Avatar'
import { Logo, NavItem, Skeleton } from './ui'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { role, logout } = useAuth()
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [organizationSwitcherOpen, setOrganizationSwitcherOpen] = useState(false)
  const [organizationSearch, setOrganizationSearch] = useState('')
  const [highlightedOrganizationIndex, setHighlightedOrganizationIndex] = useState(0)
  const activeOrgId = useActiveOrganizationId()
  const menuRef = useRef<HTMLDivElement>(null)
  const switcherRef = useRef<HTMLDivElement>(null)
  const switcherTriggerRef = useRef<HTMLButtonElement>(null)
  const switcherSearchRef = useRef<HTMLInputElement>(null)
  const switcherOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const switcherWasOpen = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => getData<Profile>('/users/me'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const memberships = profile.data?.memberships?.filter((membership) => membership.status === 'ACTIVE') ?? []
  const activeMembership = memberships.find((membership) => String(membership.organizationId) === activeOrgId)
  const initialMembership = memberships.find(
    (membership) => membership.organizationId === profile.data?.activeOrganizationId) ?? memberships[0]
  const resolvedOrgId = activeMembership ? activeOrgId : initialMembership?.organizationId.toString() ?? null
  const organization = useQuery({
    queryKey: ['organization', resolvedOrgId],
    queryFn: () => getData<Organization>('/organizations/current'),
    enabled: Boolean(resolvedOrgId),
  })
  const activeRole = activeMembership?.role === 'OWNER' ? 'ORG_ADMIN'
    : activeMembership?.role ?? (profile.data?.systemRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : role)
  const filteredMemberships = memberships.filter((membership) =>
    membership.name.toLowerCase().includes(organizationSearch.trim().toLowerCase()))
  const filteredOwners = filteredMemberships.filter((membership) =>
    membership.role === 'OWNER' || membership.role === 'ORG_ADMIN')
  const filteredOthers = filteredMemberships.filter((membership) =>
    membership.role !== 'OWNER' && membership.role !== 'ORG_ADMIN')
  const activeOrganizationIndex = filteredMemberships.findIndex(
    (membership) => String(membership.organizationId) === resolvedOrgId)

  useEffect(() => {
    if (profile.data && !activeMembership && resolvedOrgId !== activeOrgId) {
      setActiveOrganizationId(resolvedOrgId)
    }
  }, [activeMembership, activeOrgId, profile.data, resolvedOrgId])

  useEffect(() => {
    setMenuOpen(false)
    setOrganizationSwitcherOpen(false)
    setOrganizationSearch('')
  }, [location.pathname])

  useEffect(() => {
    if (!organizationSwitcherOpen) {
      if (switcherWasOpen.current) requestAnimationFrame(() => switcherTriggerRef.current?.focus())
      switcherWasOpen.current = false
      return
    }
    switcherWasOpen.current = true
    requestAnimationFrame(() => {
      if (memberships.length > 5) switcherSearchRef.current?.focus()
      else switcherOptionRefs.current[highlightedOrganizationIndex]?.focus()
    })
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !switcherRef.current?.contains(event.target)) {
        setOrganizationSwitcherOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [organizationSwitcherOpen, memberships.length, highlightedOrganizationIndex])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const onLogout = async () => {
    const refreshToken = getRefreshToken()
    let warning = ''
    try {
      if (refreshToken) await sendData('/auth/logout', { refreshToken })
    } catch (reason) {
      warning = getApiError(reason).message
    } finally {
      logout()
      navigate('/login', { replace: true, state: warning ? { message: `You are signed out locally. The server could not confirm token revocation: ${warning}` } : { message: 'You have been signed out.' } })
    }
  }

  const changeOrganization = (organizationId: string) => {
    setActiveOrganizationId(organizationId || null)
    setOrganizationSwitcherOpen(false)
    setOrganizationSearch('')
    void queryClient.invalidateQueries()
  }

  const handleSwitcherKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOrganizationSwitcherOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = filteredMemberships.length
        ? (highlightedOrganizationIndex + direction + filteredMemberships.length) % filteredMemberships.length
        : 0
      setHighlightedOrganizationIndex(nextIndex)
      requestAnimationFrame(() => switcherOptionRefs.current[nextIndex]?.focus())
      return
    }
    if (event.key === 'Enter' && filteredMemberships[highlightedOrganizationIndex]) {
      event.preventDefault()
      changeOrganization(String(filteredMemberships[highlightedOrganizationIndex].organizationId))
      return
    }
    if (event.key === 'Tab') {
      const focusable = switcherRef.current?.querySelectorAll<HTMLElement>('[data-switcher-focusable="true"]')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const renderOrganizationOption = (membership: typeof memberships[number], index: number) => (
    <button
      key={membership.organizationId}
      ref={(element) => { switcherOptionRefs.current[index] = element }}
      type="button"
      role="option"
      aria-selected={String(membership.organizationId) === activeOrgId}
      className={`organization-switcher-option ${String(membership.organizationId) === activeOrgId ? 'organization-switcher-option-active' : ''}`}
      data-switcher-focusable="true"
      tabIndex={-1}
      title={membership.name}
      onFocus={() => setHighlightedOrganizationIndex(index)}
      onClick={() => changeOrganization(String(membership.organizationId))}
    >
      <Avatar
        name={membership.name}
        path={`/organizations/${membership.organizationId}/logo`}
        version={membership.logoVersion}
        size={32}
        alt={`${membership.name} logo`}
      />
      <span className="organization-switcher-option-name">{membership.name}</span>
      <span className="organization-switcher-role">{displayRole(membership.role)}</span>
      <span className="organization-switcher-check">
        {String(membership.organizationId) === activeOrgId && <Check size={16} aria-label="Active organization" />}
      </span>
    </button>
  )

  const nav = (
    <>
      <div className="sidebar-brand"><Logo light /></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <NavItem to="/face" icon={Fingerprint} active={location.pathname === '/face'} onClick={() => setDrawerOpen(false)}>Face Security</NavItem>
        <NavItem to="/profile" icon={CircleUserRound} active={location.pathname === '/profile'} onClick={() => setDrawerOpen(false)}>Profile and Devices</NavItem>
        <NavItem to="/organization" icon={Building2} active={location.pathname === '/organization'} count={profile.data?.pendingInvitationCount || undefined} onClick={() => setDrawerOpen(false)}>Organization</NavItem>
        <NavItem to="/security-audit" icon={ShieldCheck} active={location.pathname === '/security-audit'} onClick={() => setDrawerOpen(false)}>Audit log</NavItem>
      </nav>
      <div className="sidebar-footer"><BadgeLine role={activeRole} /></div>
    </>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar desktop-sidebar">{nav}</aside>
      {drawerOpen && <div className="mobile-backdrop" onClick={() => setDrawerOpen(false)}><aside className="sidebar mobile-sidebar" onClick={(event) => event.stopPropagation()}><button className="drawer-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><X size={20} /></button>{nav}</aside></div>}
      <div className="app-main">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><Menu size={20} /></button>
          <p className="breadcrumbs">Workspace <span>/</span> {location.pathname === '/security-audit' ? 'Audit log' : location.pathname.slice(1).replace('-', ' ')}</p>
          <div className="user-area">
            {memberships.length > 1 ? (
              <div className="organization-switcher" ref={switcherRef} onKeyDown={handleSwitcherKeyDown}>
                <button
                  type="button"
                  className="organization-switcher-trigger"
                  aria-label={`Working in ${activeMembership?.name ?? 'organization'}`}
                  aria-haspopup="dialog"
                  aria-expanded={organizationSwitcherOpen}
                  aria-controls="organization-switcher-popover"
                  ref={switcherTriggerRef}
                  onClick={() => {
                    setHighlightedOrganizationIndex(Math.max(0, activeOrganizationIndex))
                    setOrganizationSwitcherOpen((open) => !open)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      setHighlightedOrganizationIndex(Math.max(0, activeOrganizationIndex))
                      setOrganizationSwitcherOpen(true)
                    }
                  }}
                >
                  <Avatar
                    name={activeMembership?.name ?? 'Organization'}
                    path={activeMembership ? `/organizations/${activeMembership.organizationId}/logo` : null}
                    version={activeMembership?.logoVersion}
                    size={24}
                    alt=""
                  />
                  <span className="organization-switcher-trigger-name">{activeMembership?.name ?? 'Organization'}</span>
                  <span className="organization-switcher-role">{displayRole(activeMembership?.role)}</span>
                  <ChevronDown size={15} aria-hidden />
                </button>
                {organizationSwitcherOpen && <div
                  id="organization-switcher-popover"
                  className="organization-switcher-popover"
                  role="dialog"
                  aria-label="Choose organization"
                  aria-modal="true"
                >
                  {memberships.length > 5 && <label className="organization-switcher-search">
                    <Search size={15} aria-hidden />
                    <input
                      ref={switcherSearchRef}
                      type="search"
                      aria-label="Search organizations"
                      placeholder="Search organizations"
                      value={organizationSearch}
                      data-switcher-focusable="true"
                      onChange={(event) => {
                        setOrganizationSearch(event.target.value)
                        setHighlightedOrganizationIndex(0)
                      }}
                    />
                  </label>}
                  <div className="organization-switcher-list" role="listbox" aria-label="Organizations">
                    {filteredMemberships.length === 0 && <p className="organization-switcher-empty">No organizations found.</p>}
                    {filteredOwners.length > 0 && <>
                      <p className="organization-switcher-heading">My organizations</p>
                      {filteredOwners.map((membership) => renderOrganizationOption(
                        membership, filteredMemberships.indexOf(membership)))}
                    </>}
                    {filteredOthers.length > 0 && <>
                      <p className={`organization-switcher-heading ${filteredOwners.length ? 'organization-switcher-heading-other' : ''}`}>Other organizations</p>
                      {filteredOthers.map((membership) => renderOrganizationOption(
                        membership, filteredMemberships.indexOf(membership)))}
                    </>}
                  </div>
                </div>}
              </div>
            ) : organization.isLoading ? <Skeleton lines={1} /> : memberships.length === 1 ? <span className="topbar-org">{organization.data?.name ?? ''}</span> : null}
            <div className="user-menu-container" ref={menuRef}>
              <button className="user-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
                <Avatar name={profile.data?.fullName ?? 'User'} path={profile.data ? `/users/${profile.data.id}/avatar` : null} version={profile.data?.avatarVersion} size={32} alt={`Profile photo for ${profile.data?.fullName ?? 'user'}`} />
                <span className="user-details">
                  <span className="user-name" title={profile.data?.fullName ?? undefined}>{profile.data?.fullName ?? (profile.isLoading ? 'Loading profile' : 'Account')}</span>
                  <span className="user-role">{displayRole(activeRole)}</span>
                </span>
              </button>
              {menuOpen && <div className="user-menu">
                <button onClick={() => { navigate('/profile'); setMenuOpen(false) }}>Profile and devices</button>
                <button onClick={() => void onLogout()}><LogOut size={15} /> Sign out</button>
              </div>}
            </div>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}

function BadgeLine({ role }: { role: string | null }) {
  return <span className="role-pill">{displayRole(role)}</span>
}

function displayRole(role: string | null | undefined) {
  if (!role) return 'Workspace member'
  const labels: Record<string, string> = {
    OWNER: 'Business Owner',
    ORG_ADMIN: 'Business Owner',
    ACCOUNTANT: 'Accountant',
    STAFF: 'Staff',
    VIEWER: 'Viewer',
    CLIENT: 'Client',
    SUPER_ADMIN: 'Super Admin',
  }
  return labels[role] ?? role.replaceAll('_', ' ')
}
