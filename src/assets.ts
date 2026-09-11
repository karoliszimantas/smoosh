export type Asset = {
  id: string
  src: string
  label: string
}

export const ASSETS: Asset[] = [
  { id: 'a1', src: '/assets/test.jpg', label: 'Test' },
  { id: 'a2', src: '/assets/test2.jpg', label: 'Test 2' },
  { id: 'a3', src: '/assets/test3.jpg', label: 'Test 3' }
]