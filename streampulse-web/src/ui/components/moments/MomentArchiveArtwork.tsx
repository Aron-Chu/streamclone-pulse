import { useState } from 'react'
import { verifiedArchiveArtwork, type ArchiveArtwork } from '../../../lib/archiveArtwork'

/** Verified selected-source or catalogue display metadata. No player, lookup, or separate action. */
export function MomentArchiveArtwork({ artwork }: { artwork: ArchiveArtwork }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const image = verifiedArchiveArtwork(artwork, artwork.vodId)
  if (!image || image.url === failedUrl) return null
  return <div className="moments-card-artwork">
    <img src={image.url} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(image.url)} />
    <span>Broadcast thumbnail · not the moment frame</span>
  </div>
}
