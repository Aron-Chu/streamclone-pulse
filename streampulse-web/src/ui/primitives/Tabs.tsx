import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from './cn'

export const Tabs = RadixTabs.Root

export function TabsList({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn('sc-tabs__list', className)} {...rest} />
}

export function TabsTrigger({
  className,
  ...rest
}: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return <RadixTabs.Trigger className={cn('sc-tabs__trigger', className)} {...rest} />
}

export function TabsContent({
  className,
  ...rest
}: ComponentPropsWithoutRef<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={className} {...rest} />
}
