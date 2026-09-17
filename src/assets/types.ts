export type Category = {
  id: string
  label: string
  count: number
}

export type Asset = {
  id: string
  category: string
  full: string
  thumb: string
  w: number
  h: number
  label: string
}

export type AssetSource = {
  id: string
  listCategories(): Promise<Category[]>
  browse(categoryId: string): Promise<Asset[]>
}
