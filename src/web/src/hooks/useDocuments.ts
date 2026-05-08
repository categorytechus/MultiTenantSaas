import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Document, DocumentsResponse } from '../types'
import { api, apiFetch } from '../lib/api'

export function useDocuments(params?: {
  page?: number
  size?: number
  search?: string
  from?: string
  to?: string
}) {
  const sp = new URLSearchParams()
  if (params?.page) sp.set('page', String(params.page))
  if (params?.size) sp.set('size', String(params.size))
  if (params?.search) sp.set('search', params.search)
  if (params?.from) sp.set('from', params.from)
  if (params?.to) sp.set('to', params.to)

  const qs = sp.toString()
  const path = `/documents${qs ? `?${qs}` : ''}`

  const query = useQuery({
    queryKey: ['documents', params],
    queryFn: async () => {
      const { data, error } = await api.get<DocumentsResponse | Document[]>(path)
      if (error) throw new Error(error)

      const normalize = (d: Document): Document => ({
        ...d,
        mime_type: d.mime_type ?? '',
        size_bytes: d.size_bytes ?? 0,
        file_type: d.mime_type ?? '',
        size: d.size_bytes ?? 0,
        category: (d.mime_type ?? '').startsWith('image/') ? 'image' : 'document',
        updated_at: d.created_at ?? '',
      })

      if (Array.isArray(data)) {
        const items = data.map(normalize)
        return { items, total: items.length, page: 1, size: items.length } as DocumentsResponse
      }
      const resp = data as DocumentsResponse
      return { ...resp, items: (resp.items ?? []).map(normalize) }
    },
  })
  return query
}

export function useUploadDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const { data, error } = await apiFetch<Document>('/documents', {
        method: 'POST',
        body: formData,
      })
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useIngestUrl() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await apiFetch<{ document: Document }>('/documents/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.delete(`/documents/${id}`)
      if (error) throw new Error(error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}
