import { supabase } from '@/lib/supabase'
export const LOGO_LIMITS = { minWidth:80, maxWidth:240, minHeight:40, maxHeight:120 } as const
export function companyLogoUrl(value: string | null | undefined): string | null {
 if (!value) return null
 if (value.startsWith('https://')) return value
 if (!/^[0-9a-f-]{36}\/(logo|[0-9a-f-]{36})[.](png|jpg|webp)$/.test(value)) return null
 return supabase.storage.from('company-logos').getPublicUrl(value).data.publicUrl
}
export function logoSize(width: number, height: number) {
 return {width:Math.min(240,Math.max(80,Number.isFinite(width)?width:160)),height:Math.min(120,Math.max(40,Number.isFinite(height)?height:72))}
}
