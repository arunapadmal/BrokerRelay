type Props = { compact?: boolean }

export function BrokerRelayBrand({ compact = false }: Props) {
  return <span className={`brokerRelayBrand${compact ? ' compact' : ''}`}>
    <img src="/brokerrelay-wordmark.png" alt="BrokerRelay" width={compact ? 175 : 260} height={compact ? 54 : 79} />
  </span>
}
