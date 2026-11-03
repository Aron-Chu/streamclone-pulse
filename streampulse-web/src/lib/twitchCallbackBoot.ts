// main.tsx imports this module first, so ES module order runs it before every
// other module (React, the router, Sentry, analytics) is evaluated. It strips
// the Twitch callback URL regardless of the website flag: a token that arrives
// while the flag is off is still removed and never used.
import { captureTwitchCallback } from './twitchCallback'

captureTwitchCallback()
