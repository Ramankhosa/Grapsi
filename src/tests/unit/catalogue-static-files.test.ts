import {describe,it,expect} from 'vitest'
import {NextRequest} from 'next/server'
import {middleware} from '../../../middleware'
describe('private funding source files',()=>{
 it.each(['documents','templates','intake'])('blocks direct public %s files without altering stored documents',kind=>{
  const response=middleware(new NextRequest(`http://localhost/uploads/funding-${kind}/known-file.pdf`))
  expect(response.status).toBe(404);expect(response.headers.get('cache-control')).toBe('private, no-store')
 })
 it('blocks encoded funding source URLs through the image optimiser',()=>{
  expect(middleware(new NextRequest('http://localhost/_next/image?url=%2Fuploads%2Ffunding-templates%2Fknown.png&w=640&q=75')).status).toBe(404)
 })
 it('leaves unrelated uploads and images available',()=>{
  expect(middleware(new NextRequest('http://localhost/uploads/avatar.png')).status).toBe(200)
  expect(middleware(new NextRequest('http://localhost/_next/image?url=%2Fuploads%2Favatar.png&w=640&q=75')).status).toBe(200)
 })
})
