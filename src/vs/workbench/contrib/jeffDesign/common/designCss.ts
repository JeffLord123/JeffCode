/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A numeric CSS value with its unit, e.g. `12px` or `1.5` (unit ''). */
export interface ICssLength {
	readonly value: number;
	readonly unit: string;
}

const lengthPattern = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/** Parses `12px`, `-0.5em`, `50%`, `1.5`. Returns `undefined` for keywords such as `auto`. */
export function parseCssLength(text: string): ICssLength | undefined {
	const match = lengthPattern.exec(text.trim());
	if (!match) {
		return undefined;
	}
	return { value: Number(match[1]), unit: match[2].toLowerCase() };
}

/** Formats a number for CSS output with at most 3 decimals and no trailing zeros. */
export function formatCssNumber(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function formatCssLength(length: ICssLength): string {
	return `${formatCssNumber(length.value)}${length.unit}`;
}

/** Color channels in 0-255, alpha in 0-1. */
export interface IRgba {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
}

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function parseAlpha(text: string | undefined): number {
	if (text === undefined) {
		return 1;
	}
	return clampAlpha(text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text));
}

/**
 * Parses the color notations that computed styles produce: `rgb()`/`rgba()` (comma or space
 * separated), `color(srgb r g b / a)`, hex and `transparent`. Returns `undefined` otherwise.
 */
export function parseCssColor(text: string): IRgba | undefined {
	const value = text.trim().toLowerCase();
	if (value === 'transparent') {
		return { r: 0, g: 0, b: 0, a: 0 };
	}

	if (value.startsWith('#')) {
		const hex = value.slice(1);
		if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) {
			return undefined;
		}
		const full = hex.length <= 4 ? hex.split('').map(c => c + c).join('') : hex;
		return {
			r: parseInt(full.slice(0, 2), 16),
			g: parseInt(full.slice(2, 4), 16),
			b: parseInt(full.slice(4, 6), 16),
			a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
		};
	}

	const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
	if (rgb) {
		const parts = rgb[1].split(/[\s,/]+/).filter(p => p.length > 0);
		if (parts.length < 3 || parts.slice(0, 3).some(p => Number.isNaN(Number(p)))) {
			return undefined;
		}
		return { r: clampChannel(Number(parts[0])), g: clampChannel(Number(parts[1])), b: clampChannel(Number(parts[2])), a: parseAlpha(parts[3]) };
	}

	const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value);
	if (srgb) {
		const parts = srgb[1].split(/[\s/]+/).filter(p => p.length > 0);
		if (parts.length < 3 || parts.slice(0, 3).some(p => Number.isNaN(Number(p)))) {
			return undefined;
		}
		return { r: clampChannel(Number(parts[0]) * 255), g: clampChannel(Number(parts[1]) * 255), b: clampChannel(Number(parts[2]) * 255), a: parseAlpha(parts[3]) };
	}

	return undefined;
}

/** `#RRGGBB`, uppercase, ignoring alpha. */
export function rgbaToHex(color: IRgba): string {
	const channel = (n: number) => clampChannel(n).toString(16).padStart(2, '0');
	return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase();
}

/** `#RRGGBB` when opaque, `rgba(r, g, b, a)` otherwise. */
export function formatCssColor(color: IRgba): string {
	if (color.a >= 1) {
		return rgbaToHex(color);
	}
	return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${formatCssNumber(clampAlpha(color.a))})`;
}
