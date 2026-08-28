import { ChevronRight } from 'lucide-react'
import type { NewsroomStory } from '../../../lib/newsroom'

export interface StoryHeadlineListProps {
  stories: NewsroomStory[]
  onSelect: (story: NewsroomStory) => void
}

export function StoryHeadlineList({ stories, onSelect }: StoryHeadlineListProps) {
  if (stories.length === 0) return null
  return (
    <section className="newsroom-headlines" aria-labelledby="newsroom-headlines-title">
      <h3 id="newsroom-headlines-title">Also developing</h3>
      <ul>
        {stories.slice(0, 2).map((story) => (
          <li key={story.id}>
            <button type="button" onClick={() => onSelect(story)}>
              <span>
                <strong>{story.headline}</strong>
                <small>{story.displayName || story.login} · {story.lifecycle}</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
