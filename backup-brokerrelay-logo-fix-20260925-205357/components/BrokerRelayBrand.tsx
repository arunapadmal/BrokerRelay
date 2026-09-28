type Props = { compact?: boolean }

export function BrokerRelayBrand({ compact = false }: Props) {
  return <span className={`brokerRelayBrand${compact ? ' compact' : ''}`}>
    {/* The wordmark stays visible for keyboard and touch users as well as on hover. */}
    <img src="/brokerrelay-mark.svg" alt="" width={compact ? 28 : 46} height={compact ? 28 : 46} />
    <span>BrokerRelay</span>
  </span>
}
