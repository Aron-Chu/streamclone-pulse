export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/v1/')) {
      url.hostname = 'api.streampulse.stream'
      url.protocol = 'https:'
      url.port = '443'
      return fetch(new Request(url.toString(), request))
    }
    return env.ASSETS.fetch(request)
  },
}
