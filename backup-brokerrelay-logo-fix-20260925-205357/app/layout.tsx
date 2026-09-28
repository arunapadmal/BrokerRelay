import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'BrokerRelay',
  description: 'BrokerRelay broker workspace',
  icons: { icon: '/brokerrelay-mark.svg' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
