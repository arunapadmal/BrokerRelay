import './globals.css'
import './theme-consistency.css'
import '@/components/billing.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'BrokerRelay',
  description: 'BrokerRelay broker workspace',
  icons: { icon: '/brokerrelay-logo.png' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<footer className="poweredByBrokerRelay"><a href="https://aidez.com.au" target="_blank" rel="noopener noreferrer">Powered by BrokerRelay</a></footer></body>
    </html>
  )
}
