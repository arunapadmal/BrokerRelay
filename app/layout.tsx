import './globals.css'
import './theme-consistency.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'BrokerRelay',
  description: 'BrokerRelay broker workspace',
  icons: { icon: '/brokerrelay-logo.png' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
