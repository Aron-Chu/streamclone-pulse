import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Support from '../src/routes/public/Support'

describe('billing email help', () => {
  it('gives signed-in and lost-browser routes without promising a cancellation', () => {
    render(<MemoryRouter><Support /></MemoryRouter>)
    const heading = screen.getByRole('heading', { name: "Can't get into your billing email?" })
    const section = heading.closest('section')!
    expect(section.id).toBe('billing-email')
    expect(section.textContent).toContain('Manage subscription and change the email')
    expect(section.textContent).toContain("We'll review your request to stop future renewals")
    expect(section.textContent).toContain('Never send your full card number, security code or ID')
    expect(section.textContent).not.toContain("it won't renew")
    expect(within(section).getByRole('link', { name: 'privacy@streampulse.stream' }).getAttribute('href')).toBe('mailto:privacy@streampulse.stream')
  })
})
