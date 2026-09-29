/**
 * TradeSight NIFTY 50 - Dedicated Indicator Chart Overlay Renderer (TypeScript Definition)
 *
 * Renders non-destructive SVG layers for:
 *  - NSDT 3-Tier Horizontal S/R lines with right-aligned price badges
 *  - Multi-tier S/R Cluster shaded zones
 *  - 30/30 Pivot Trendlines with slope and touch markers
 *
 * ZERO FOOTPRINT RULE:
 *  - When master or child toggles are OFF, all SVG elements are instantly detached.
 */

import { UnifiedIndicatorState, IndicatorDrawingData } from '../indicators/indicatorManager';

export interface IndicatorRenderParams {
  indicatorState: UnifiedIndicatorState | null;
  svgContainer: SVGSVGElement | null;
  chartWidth: number;
  chartHeight: number;
  minPrice: number;
  maxPrice: number;
}

export class IndicatorRenderer {
  private static GROUP_ID = 'tradesight-indicators-layer';

  /**
   * Main render function
   */
  public static render(params: IndicatorRenderParams): void {
    const { indicatorState, svgContainer, chartWidth, chartHeight, minPrice, maxPrice } = params;

    if (!svgContainer) return;

    let group = svgContainer.querySelector(`#${this.GROUP_ID}`) as SVGGElement | null;

    // ZERO FOOTPRINT RULE: If disabled or no state, cleanly unmount immediately
    if (!indicatorState || !indicatorState.masterEnabled) {
      if (group) group.remove();
      return;
    }

    if (!group) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.id = this.GROUP_ID;
      svgContainer.appendChild(group);
    } else {
      group.innerHTML = ''; // reset previous elements
    }

    const priceRange = Math.max(1, maxPrice - minPrice);
    const getY = (price: number): number => {
      const normalized = (price - minPrice) / priceRange;
      const y = chartHeight * (1.0 - normalized);
      return Math.max(10, Math.min(chartHeight - 10, y));
    };

    const drawings = indicatorState.drawings || [];

    // 1. Draw Cluster Zones first (background shading)
    drawings
      .filter((d) => d.type === 'ZONE_BOX' && d.y2 !== undefined)
      .forEach((d) => {
        const yTop = getY(d.y1);
        const yBottom = getY(d.y2!);
        const boxHeight = Math.max(3, yBottom - yTop);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '60');
        rect.setAttribute('y', yTop.toString());
        rect.setAttribute('width', (chartWidth - 130).toString());
        rect.setAttribute('height', boxHeight.toString());
        rect.setAttribute('fill', d.color);
        rect.setAttribute('stroke', d.color.replace('0.12', '0.4').replace('0.18', '0.6'));
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('stroke-dasharray', '4 4');
        group!.appendChild(rect);

        if (d.label) {
          this.drawBadge(group!, 70, (yTop + yBottom) / 2, d.label, '#FBBF24', '#0B0F19');
        }
      });

    // 2. Draw NSDT Horizontal Lines
    drawings
      .filter((d) => d.type === 'HORIZONTAL_LINE')
      .forEach((d) => {
        const y = getY(d.y1);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '50');
        line.setAttribute('y1', y.toString());
        line.setAttribute('x2', (chartWidth - 65).toString());
        line.setAttribute('y2', y.toString());
        line.setAttribute('stroke', d.color);
        line.setAttribute('stroke-width', d.width.toString());

        if (d.style === 'dotted') line.setAttribute('stroke-dasharray', '2 3');
        else if (d.style === 'dashed') line.setAttribute('stroke-dasharray', '6 4');

        group!.appendChild(line);

        // Right axis badge
        if (d.label) {
          const badgeX = chartWidth - 65;
          this.drawRightAxisBadge(group!, badgeX, y, d.label, d.color, '#0B0F19');
        }
      });

    // 3. Draw 30/30 Trendlines
    drawings
      .filter((d) => d.type === 'TRENDLINE' && d.y2 !== undefined)
      .forEach((d) => {
        const yStart = getY(d.y1);
        const yEnd = getY(d.y2!);
        const xStart = 80; // approximate origin mapping
        const xEnd = chartWidth - 80;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', xStart.toString());
        line.setAttribute('y1', yStart.toString());
        line.setAttribute('x2', xEnd.toString());
        line.setAttribute('y2', yEnd.toString());
        line.setAttribute('stroke', d.color);
        line.setAttribute('stroke-width', d.width.toString());

        if (d.style === 'dashed') line.setAttribute('stroke-dasharray', '8 4');

        group!.appendChild(line);

        if (d.label) {
          this.drawBadge(group!, xEnd - 160, yEnd - 12, d.label, d.color, '#0B0F19');
        }
      });
  }

  private static drawBadge(
    group: SVGGElement,
    x: number,
    y: number,
    text: string,
    strokeColor: string,
    bgColor: string
  ): void {
    const badgeW = text.length * 6.5 + 14;
    const badgeH = 18;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', (y - badgeH / 2).toString());
    rect.setAttribute('width', badgeW.toString());
    rect.setAttribute('height', badgeH.toString());
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', bgColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', '1');
    group.appendChild(rect);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', (x + badgeW / 2).toString());
    txt.setAttribute('y', (y + 4).toString());
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', strokeColor);
    txt.setAttribute('font-size', '9.5');
    txt.setAttribute('font-weight', '700');
    txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    txt.textContent = text;
    group.appendChild(txt);
  }

  private static drawRightAxisBadge(
    group: SVGGElement,
    rightX: number,
    y: number,
    text: string,
    strokeColor: string,
    bgColor: string
  ): void {
    const badgeW = text.length * 6.8 + 14;
    const badgeH = 20;
    const x = rightX - badgeW;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', (y - badgeH / 2).toString());
    rect.setAttribute('width', badgeW.toString());
    rect.setAttribute('height', badgeH.toString());
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', bgColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', '1.2');
    group.appendChild(rect);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', (x + badgeW / 2).toString());
    txt.setAttribute('y', (y + 4).toString());
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', strokeColor);
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-weight', '800');
    txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    txt.textContent = text;
    group.appendChild(txt);
  }

  public static clear(svgContainer: SVGSVGElement | null): void {
    if (!svgContainer) return;
    const group = svgContainer.querySelector(`#${this.GROUP_ID}`);
    if (group) group.remove();
  }
}
