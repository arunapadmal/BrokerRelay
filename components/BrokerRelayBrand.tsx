type Props = { compact?: boolean }

export function BrokerRelayBrand({ compact = false }: Props) {
  return <span className={`brokerRelayBrand${compact ? ' compact' : ''}`}>
    <img src="/brokerrelay-wordmark.png?v=20261009b" alt="BrokerRelay" width={compact ? 175 : 260} height={compact ? 36 : 53} style={{ height: 'auto', objectFit: 'contain', mixBlendMode: 'normal' }} />
  </span>
}
