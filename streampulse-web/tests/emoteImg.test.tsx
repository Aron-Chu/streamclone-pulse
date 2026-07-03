import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmoteImg } from '../src/ui/components/analytics/EmoteImg'

describe('EmoteImg', () => {
  it('falls back to text when the image fails to load', () => {
    const { container } = render(<EmoteImg src="https://cdn.example.test/missing.webp" name="KEKW" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as HTMLImageElement)
    expect(screen.getByText('K')).toBeTruthy()
  })
})