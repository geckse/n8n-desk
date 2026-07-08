import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useMcpHealth } from '@/composables/useMcpHealth'
import type { McpStatusResult } from '@/types/mcp'

const mockMcpStatus = vi.fn<(instanceId?: string) => Promise<McpStatusResult>>()

function installBridge(): void {
  ;(window as unknown as { n8nDesk: unknown }).n8nDesk = {
    agent: { mcpStatus: mockMcpStatus },
  }
}

describe('useMcpHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockMcpStatus.mockReset()
    installBridge()
    // Singleton state persists across tests — always start from a clean slate.
    useMcpHealth().resetStatus()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { n8nDesk?: unknown }).n8nDesk
  })

  it('reflects a connected status after checkNow', async () => {
    mockMcpStatus.mockResolvedValue({ status: 'connected', toolCount: 30 })
    const health = useMcpHealth()

    expect(health.status.value).toBe('unknown')
    await health.checkNow()

    expect(health.status.value).toBe('connected')
    expect(health.toolCount.value).toBe(30)
    expect(health.isHealthy.value).toBe(true)
    expect(health.isBroken.value).toBe(false)
  })

  it('marks unauthorized and unreachable as broken', async () => {
    const health = useMcpHealth()

    mockMcpStatus.mockResolvedValue({ status: 'unauthorized' })
    await health.checkNow()
    expect(health.status.value).toBe('unauthorized')
    expect(health.isBroken.value).toBe(true)

    mockMcpStatus.mockResolvedValue({ status: 'unreachable', error: 'fetch failed' })
    await health.checkNow()
    expect(health.status.value).toBe('unreachable')
    expect(health.lastError.value).toBe('fetch failed')
    expect(health.isBroken.value).toBe(true)
  })

  it('treats an IPC failure as unreachable instead of throwing', async () => {
    mockMcpStatus.mockRejectedValue(new Error('ipc boom'))
    const health = useMcpHealth()

    await expect(health.checkNow()).resolves.toBeNull()
    expect(health.status.value).toBe('unreachable')
    expect(health.lastError.value).toBe('ipc boom')
  })

  it('coalesces concurrent checks into one IPC round-trip', async () => {
    let resolveCheck: (r: McpStatusResult) => void = () => {}
    mockMcpStatus.mockImplementation(
      () => new Promise<McpStatusResult>((resolve) => { resolveCheck = resolve }),
    )
    const health = useMcpHealth()

    const first = health.checkNow()
    const second = health.checkNow()
    resolveCheck({ status: 'connected', toolCount: 5 })
    await Promise.all([first, second])

    expect(mockMcpStatus).toHaveBeenCalledTimes(1)
    expect(health.status.value).toBe('connected')
  })

  it('polls while monitored and stops when the last lease is released', async () => {
    mockMcpStatus.mockResolvedValue({ status: 'connected', toolCount: 1 })
    const health = useMcpHealth()

    health.startMonitoring() // immediate check
    health.startMonitoring() // second lease, no extra check
    await vi.advanceTimersByTimeAsync(0)
    expect(mockMcpStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockMcpStatus).toHaveBeenCalledTimes(2)

    health.stopMonitoring() // one lease remains — keep polling
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockMcpStatus).toHaveBeenCalledTimes(3)

    health.stopMonitoring() // last lease released — polling stops
    await vi.advanceTimersByTimeAsync(180_000)
    expect(mockMcpStatus).toHaveBeenCalledTimes(3)
  })

  it('resetStatus clears state back to unknown', async () => {
    mockMcpStatus.mockResolvedValue({ status: 'connected', toolCount: 12 })
    const health = useMcpHealth()
    await health.checkNow()
    expect(health.status.value).toBe('connected')

    health.resetStatus()
    expect(health.status.value).toBe('unknown')
    expect(health.toolCount.value).toBeNull()
    expect(health.lastError.value).toBeNull()
  })
})
