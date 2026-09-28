import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Aidez BrokerDesk',
  description: 'AidezConnect broker workspace',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
