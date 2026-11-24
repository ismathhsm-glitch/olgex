import type { InternalAxiosRequestConfig } from 'axios'
import { useSyncExternalStore } from 'react'
import { api } from './client'

const storageKey = 'olgax.activeOrganizationId'
let activeOrganizationId = sessionStorage.getItem(storageKey)

export function getActiveOrganizationId(): string | null {
  return activeOrganizationId
}

function subscribe(callback: () => void) {
  window.addEventListener('olgax:organization-changed', callback)
  return () => window.removeEventListener('olgax:organization-changed', callback)
}

export function useActiveOrganizationId(): string | null {
  return useSyncExternalStore(subscribe, getActiveOrganizationId, () => null)
}

export function setActiveOrganizationId(organizationId: number | string | null) {
  activeOrganizationId = organizationId === null ? null : String(organizationId)
  if (activeOrganizationId) sessionStorage.setItem(storageKey, activeOrganizationId)
  else sessionStorage.removeItem(storageKey)
  window.dispatchEvent(new Event('olgax:organization-changed'))
}

function isOrganizationIndependentRequest(url?: string): boolean {
  const path = url?.split('?')[0] ?? ''
  return path === '/organizations'
    || path === '/organizations/invitations/accept'
    || path === '/organizations/invitations/preview'
    || path === '/audit-logs'
    || path.startsWith('/auth/')
    || path.startsWith('/devices')
    || path.startsWith('/face/')
    || path.startsWith('/security/')
    || path === '/users/me'
    || path.startsWith('/users/me/')
    || /^\/users\/\d+\/avatar$/.test(path)
    || /^\/organizations\/\d+\/logo$/.test(path)
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (activeOrganizationId && !isOrganizationIndependentRequest(config.url)) {
    config.headers.set('X-Organization-Id', activeOrganizationId)
  }
  else config.headers.delete('X-Organization-Id')
  return config
})
