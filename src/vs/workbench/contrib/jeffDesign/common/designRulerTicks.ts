/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A graduation of a design ruler. */
export interface IRulerTick {
	/** Offset along the ruler, in workbench CSS px from the ruler start. */
	readonly position: number;
	/** Page coordinate of the graduation, in CSS px of the page. */
	readonly value: number;
	/** Major graduations are longer and carry a {@link label}. */
	readonly major: boolean;
	/** The value written next to a major graduation. */
	readonly label?: string;
}

/** Candidate distances between major graduations, in page px, smallest first. */
const majorSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

/** Minimum distance between major graduations, in workbench px, so that their labels fit. */
const minMajorSpacing = 50;

/** Minimum distance between minor graduations, in workbench px. */
const minMinorSpacing = 5;

/** Ways to divide a major step into minor graduations, finest first. */
const subdivisions = [10, 5, 2];

/** Bound on the graduations of one ruler, against absurd lengths or scales. */
const maxTicks = 10_000;

/** The smallest major step, in page px, whose graduations are at least {@link minMajorSpacing} apart. */
function majorStepFor(scale: number): number {
	const step = majorSteps.find(candidate => candidate * scale >= minMajorSpacing);
	if (step !== undefined) {
		return step;
	}
	// Pages zoomed out beyond the table: go on with steps of 2, 5 and 10 times a power of ten.
	for (let magnitude = majorSteps[majorSteps.length - 1]; Number.isFinite(magnitude); magnitude *= 10) {
		for (const factor of [2, 5, 10]) {
			if (magnitude * factor * scale >= minMajorSpacing) {
				return magnitude * factor;
			}
		}
	}
	return Infinity;
}

/**
 * Computes the graduations of a ruler, in the order they appear along it.
 *
 * @param start Page coordinate at the start of the ruler, in page px.
 * @param length Length of the ruler, in workbench px.
 * @param scale Workbench px per page px, greater than 0.
 */
export function computeRulerTicks(start: number, length: number, scale: number): IRulerTick[] {
	if (!Number.isFinite(start) || !Number.isFinite(length) || length < 0 || !Number.isFinite(scale) || scale <= 0) {
		return [];
	}
	const majorStep = majorStepFor(scale);
	if (!Number.isFinite(majorStep)) {
		return [];
	}
	const count = subdivisions.find(subdivision => majorStep * scale / subdivision >= minMinorSpacing) ?? 1;
	// Graduation `index` is at the page coordinate `index * majorStep / count`. One more graduation on
	// each side absorbs rounding errors; those outside the ruler are filtered out below.
	const first = Math.ceil(start * count / majorStep) - 1;
	const last = Math.floor((start + length / scale) * count / majorStep) + 1;
	if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > maxTicks) {
		return [];
	}
	const ticks: IRulerTick[] = [];
	for (let index = first; index <= last; index++) {
		// Multiplying before dividing keeps the values exact: 2.5, not 2.5000000000000004.
		const value = index * majorStep / count;
		const position = (value - start) * scale;
		if (position < 0 || position > length) {
			continue;
		}
		ticks.push(index % count === 0 ? { position, value, major: true, label: String(value) } : { position, value, major: false });
	}
	return ticks;
}
