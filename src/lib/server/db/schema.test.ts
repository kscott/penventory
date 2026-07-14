import { describe, expect, it } from 'vitest';
import {
	brandId,
	brands,
	fillingSystemId,
	filling_systems,
	finishId,
	finishes,
	import_attempts,
	importAttemptId,
	lineId,
	lines,
	modelId,
	models,
	nibBaseSizeId,
	nibId,
	nibMaterialId,
	nibPointSizeId,
	nibPurityId,
	nibShapeId,
	nib_base_sizes,
	nib_materials,
	nib_point_sizes,
	nib_purities,
	nib_shapes,
	nibs,
	penId,
	penMaterialId,
	pen_materials,
	pens,
	tagId,
	tags,
	vendorId,
	vendors
} from './schema';

describe('schema helpers', () => {
	it('brandId resolves lines/models.brand_id to brands.id', () => {
		expect(brandId()).toBe(brands.id);
	});

	// Only invoked by drizzle-kit during migration generation, never at
	// runtime — each needs a direct call here for function coverage, same
	// reasoning as brandId above.
	it.each([
		['modelId', modelId, () => models.id],
		['penMaterialId', penMaterialId, () => pen_materials.id],
		['finishId', finishId, () => finishes.id],
		['fillingSystemId', fillingSystemId, () => filling_systems.id],
		['nibMaterialId', nibMaterialId, () => nib_materials.id],
		['nibShapeId', nibShapeId, () => nib_shapes.id],
		['vendorId', vendorId, () => vendors.id],
		['lineId', lineId, () => lines.id],
		['nibPurityId', nibPurityId, () => nib_purities.id],
		['nibBaseSizeId', nibBaseSizeId, () => nib_base_sizes.id],
		['nibPointSizeId', nibPointSizeId, () => nib_point_sizes.id],
		['tagId', tagId, () => tags.id],
		['penId', penId, () => pens.id],
		['nibId', nibId, () => nibs.id],
		['importAttemptId', importAttemptId, () => import_attempts.id]
	] as const)('%s resolves to its target column', (_name, closure, expected) => {
		expect(closure()).toBe(expected());
	});
});
