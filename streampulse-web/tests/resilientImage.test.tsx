import { fireEvent, render, screen } from '@testing-library/react'
import { ResilientImage } from '../src/ui/components/ResilientImage'

describe('ResilientImage', () => {
  it('shows the fallback when the source is missing', () => {
    render(<ResilientImage fallback={<span>SC</span>} alt="" />)

    expect(screen.getByText('SC')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('replaces a failed image with the fallback', () => {
    render(<ResilientImage src="https://example.test/avatar.png" fallback={<span>SC</span>} alt="Streamer" />)

    fireEvent.error(screen.getByRole('img', { name: 'Streamer' }))

    expect(screen.getByText('SC')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('tries again when the source URL changes', () => {
    const view = render(
      <ResilientImage src="https://example.test/old.png" fallback={<span>SC</span>} alt="Streamer" />,
    )
    fireEvent.error(screen.getByRole('img', { name: 'Streamer' }))

    view.rerender(
      <ResilientImage src="https://example.test/new.png" fallback={<span>SC</span>} alt="Streamer" />,
    )

    expect(screen.getByRole('img', { name: 'Streamer' }).getAttribute('src')).toBe(
      'https://example.test/new.png',
    )
  })

  it('tries the fallback source before the fallback content', () => {
    render(<ResilientImage src="https://example.test/small.png" fallbackSrc="https://example.test/original.png" fallback={<span>SC</span>} alt="Streamer" />)

    fireEvent.error(screen.getByRole('img', { name: 'Streamer' }))
    expect(screen.getByRole('img', { name: 'Streamer' }).getAttribute('src')).toBe('https://example.test/original.png')

    fireEvent.error(screen.getByRole('img', { name: 'Streamer' }))
    expect(screen.getByText('SC')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('uses the fallback source when the primary source is absent', () => {
    render(<ResilientImage fallbackSrc="https://example.test/original.png" fallback={<span>SC</span>} alt="Streamer" />)
    expect(screen.getByRole('img', { name: 'Streamer' }).getAttribute('src')).toBe('https://example.test/original.png')
  })
})
