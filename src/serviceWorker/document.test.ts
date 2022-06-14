import { RouteHandlerCallbackOptions, RouteMatchCallbackOptions } from 'workbox-core'
import { matchPrecache as matchPrecacheMock } from 'workbox-precaching'

import { CachedDocument, DOCUMENT, handleDocument, matchDocument } from './document'

jest.mock('workbox-navigation-preload', () => ({ enable: jest.fn() }))
jest.mock('workbox-precaching', () => ({ matchPrecache: jest.fn() }))
jest.mock('workbox-routing', () => ({ Route: class {} }))

describe('document', () => {
  describe('matchDocument', () => {
    const TEST_DOCUMENTS = [
      [{ request: {}, url: { hostname: 'example.com', pathname: '' } }, false],
      [{ request: { mode: 'navigate' }, url: { hostname: 'example.com', pathname: '' } }, false],
      [{ request: {}, url: { hostname: 'app.uniswap.org', pathname: '' } }, false],
      [{ request: { mode: 'navigate' }, url: { hostname: 'app.uniswap.org', pathname: '' } }, true],
      [{ request: { mode: 'navigate' }, url: { hostname: 'app.uniswap.org', pathname: '/#/swap' } }, true],
      [{ request: { mode: 'navigate' }, url: { hostname: 'app.uniswap.org', pathname: '/asset.gif' } }, false],
      [{ request: {}, url: { hostname: 'localhost', pathname: '' } }, false],
      [{ request: { mode: 'navigate' }, url: { hostname: 'localhost', pathname: '' } }, true],
      [{ request: { mode: 'navigate' }, url: { hostname: 'localhost', pathname: '/#/swap' } }, true],
      [{ request: { mode: 'navigate' }, url: { hostname: 'localhost', pathname: '/asset.gif' } }, false],
    ] as [RouteMatchCallbackOptions, boolean][]

    it.each(TEST_DOCUMENTS)('%j', (document: RouteMatchCallbackOptions, expected: boolean) => {
      jest.spyOn(window, 'location', 'get').mockReturnValue({ hostname: document.url.hostname } as Location)
      expect(matchDocument(document)).toBe(expected)
    })
  })

  describe('handleDocument', () => {
    let fetch: jest.SpyInstance
    let matchPrecache: jest.SpyInstance
    let options: RouteHandlerCallbackOptions

    beforeAll(() => {
      fetch = jest.spyOn(window, 'fetch')
      matchPrecache = matchPrecacheMock as unknown as jest.SpyInstance
    })

    beforeEach(() => {
      fetch.mockReset()
      options = {
        event: new Event('fetch') as ExtendableEvent,
        request: new Request('http://example.com'),
        url: new URL('http://example.com'),
      }
    })

    describe('when offline', () => {
      let onLine: jest.SpyInstance

      beforeAll(() => {
        onLine = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      })

      afterAll(() => onLine.mockRestore())

      it('returns a fetched document', async () => {
        const fetched = new Response()
        fetch.mockResolvedValueOnce(fetched)
        const response = await handleDocument(options)
        expect(fetch).toHaveBeenCalledWith(options.request)
        expect(response).toBe(fetched)
      })

      it('returns a clone of offlineDocument with an offlineDocument', async () => {
        const offlineDocument = new Response()
        const offlineClone = offlineDocument.clone()
        jest.spyOn(offlineDocument, 'clone').mockReturnValueOnce(offlineClone)
        const response = await handleDocument.call({ offlineDocument }, options)
        expect(fetch).not.toHaveBeenCalled()
        expect(response).toBe(offlineClone)
      })
    })

    describe('with a thrown fetch', () => {
      it('returns a cached response', async () => {
        const cached = new Response()
        matchPrecache.mockResolvedValueOnce(cached)
        fetch.mockRejectedValueOnce(new Error())
        const { response } = (await handleDocument(options)) as CachedDocument
        expect(response).toBe(cached)
      })

      it('rethrows with no cached response', async () => {
        const error = new Error()
        fetch.mockRejectedValueOnce(error)
        await expect(handleDocument(options)).rejects.toThrow(error)
      })
    })

    describe.each([
      ['preloadResponse', true],
      ['fetched document', false],
    ])('with a %s', (responseType, withPreloadResponse) => {
      let fetched: Response
      const FETCHED_ETAGS = 'fetched'

      beforeEach(() => {
        fetched = new Response(null, { headers: { etag: FETCHED_ETAGS } })
        if (withPreloadResponse) {
          ;(options.event as { preloadResponse?: Promise<Response> }).preloadResponse = Promise.resolve(fetched)
        } else {
          fetch.mockReturnValueOnce(fetched)
        }
      })

      afterEach(() => {
        if (withPreloadResponse) {
          expect(fetch).not.toHaveBeenCalled()
        } else {
          expect(fetch).toHaveBeenCalledWith(DOCUMENT, expect.anything())
        }
      })

      describe('with a cached response', () => {
        let cached: Response

        beforeEach(() => {
          cached = new Response('<html>cached</html>', { headers: { etag: 'cached' } })
          matchPrecache.mockResolvedValueOnce(cached)
        })

        describe('with matched etags', () => {
          beforeEach(() => {
            cached.headers.set('etag', FETCHED_ETAGS)
          })

          if (!withPreloadResponse) {
            it('aborts the fetched response', async () => {
              await handleDocument(options)
              const abortSignal = fetch.mock.calls[0][1].signal
              expect(abortSignal.aborted).toBeTruthy()
            })
          }

          it('returns the cached response', async () => {
            const { response } = (await handleDocument(options)) as CachedDocument
            expect(response).toBe(cached)
          })
        })

        it(`returns the ${responseType} with mismatched etags`, async () => {
          const response = await handleDocument(options)
          expect(response).toBe(fetched)
        })
      })

      it(`returns the ${responseType} with no cached response`, async () => {
        const response = await handleDocument(options)
        expect(response).toBe(fetched)
      })
    })
  })
})