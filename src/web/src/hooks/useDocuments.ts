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
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.size) query.set('size', String(params.size))
  if (params?.search) query.set('search', params.search)
  if (params?.from) query.set('from', params.from)
  if (params?.to) query.set('to', params.to)

  const qs = query.toString()
  const path = `/documents${qs ? `?${qs}` : ''}`

  return useQuery({
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
