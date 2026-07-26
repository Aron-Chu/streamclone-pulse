import { useEffect, useState } from 'react'

export function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(active ? target : 0)

  useEffect(() => {
    setValue(active ? target : 0)
  }, [active, target])

  return value
}