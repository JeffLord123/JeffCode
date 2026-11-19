/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_ERROR, CONTEXT_BROWSER_HAS_URL } from '../../browserView/electron-browser/browserEditor.js';
import { DesignMeasureCategory } from '../common/designOverlay.js';

/**
 * Group of the integrated browser's actions toolbar that holds the JeffCode design tools. Groups are
 * sorted by name, so `3_design` comes right before the upstream `3_tools` group and the design
 * buttons are the last to overflow when the toolbar is narrow.
 */
export const DESIGN_TOOLBAR_GROUP = '3_design';

/** Order of the design tools within {@link DESIGN_TOOLBAR_GROUP}. */
export const DesignToolbarOrder = {
	OpenBrowser: 0,
	Panel: 1,
	SelectElement: 2,
	Rulers: 3,
	Measure: 4,
	Mirror: 5,
} as const;

/** Dropdown of the Measure split button. */
export const JeffDesignMeasureMenu = new MenuId('JeffDesignMeasureMenu');

/** Dropdown of the Mirror Mode split button. */
export const JeffDesignMirrorMenu = new MenuId('JeffDesignMirrorMenu');

/** The active editor is an integrated browser showing a page. */
export const DESIGN_PAGE_PRECONDITION = ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL, CONTEXT_BROWSER_HAS_ERROR.negate());

/** Bound per browser editor. */
export const CONTEXT_DESIGN_RULERS = new RawContextKey<boolean>('jeffDesignRulers', false, localize('jeffDesign.rulersVisible', "Whether the rulers are shown in the current browser view"));

/** Bound per browser editor. */
export const CONTEXT_DESIGN_MEASURE = new RawContextKey<boolean>('jeffDesignMeasure', false, localize('jeffDesign.measureActive', "Whether the Measure tool is active in the current browser view"));

/** Bound globally: one mirror session at a time. */
export const CONTEXT_DESIGN_MIRROR_ACTIVE = new RawContextKey<boolean>('jeffDesignMirrorActive', false, localize('jeffDesign.mirrorActive', "Whether Mirror Mode compares the last commit with the uncommitted changes"));

/** Bound globally. */
export const CONTEXT_DESIGN_MIRROR_SYNC_NAVIGATION = new RawContextKey<boolean>('jeffDesignMirrorSyncNavigation', false, localize('jeffDesign.mirrorSyncNavigation', "Whether Mirror Mode opens on one side the pages opened on the other"));
export const CONTEXT_DESIGN_MIRROR_SYNC_SCROLL = new RawContextKey<boolean>('jeffDesignMirrorSyncScroll', false,localize('jeffDesign.mirrorSyncScroll', "Whether Mirror Mode keeps the scroll position of both pages in sync"));

/** Bound globally, one key per measure category, true when the category is shown. */
export const CONTEXT_DESIGN_MEASURE_CATEGORIES: { readonly [K in DesignMeasureCategory]: RawContextKey<boolean> } = {
	gap: new RawContextKey<boolean>('jeffDesignMeasureGap', true, localize('jeffDesign.measureGap', "Whether the Measure tool shows the gaps between elements")),
	padding: new RawContextKey<boolean>('jeffDesignMeasurePadding', true, localize('jeffDesign.measurePadding', "Whether the Measure tool shows paddings")),
	margin: new RawContextKey<boolean>('jeffDesignMeasureMargin', false, localize('jeffDesign.measureMargin', "Whether the Measure tool shows margins")),
	components: new RawContextKey<boolean>('jeffDesignMeasureComponents', false, localize('jeffDesign.measureComponents', "Whether the Measure tool shows the components and their size")),
	typography: new RawContextKey<boolean>('jeffDesignMeasureTypography', false, localize('jeffDesign.measureTypography', "Whether the Measure tool shows font sizes")),
};
