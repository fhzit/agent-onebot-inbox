export function productionRequiresDatabase(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production';
}
