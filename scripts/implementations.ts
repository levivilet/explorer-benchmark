import type { Implementation } from './types.ts'

export const labels: Record<Implementation, string> = { lvce: 'LVCE explorer-view', pierre: 'Pierre / trees.software', arborist: 'React Arborist', headless: 'Headless Tree (DOM host)', jstree: 'jsTree' }
export const implementations: Implementation[] = Object.keys(labels) as Implementation[]
