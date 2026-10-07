'use client';

/**
 * COMPAT (R12-b merge): Boulder Yard II is no longer a separate game — it is
 * the factory campaign INSIDE the unified Boulder Yard game (shared garage,
 * driver profile and money). This module re-exports the unified component
 * booting with the campaign-2 tab preselected, so every old reference keeps
 * working.
 */
export { BoulderYardGame2 } from './BoulderYardGame';
