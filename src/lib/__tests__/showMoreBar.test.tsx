import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ShowMoreBar from '../../components/ui/ShowMoreBar';
import { LIST_PAGE_SIZE, useProgressiveList } from '../../hooks/useProgressiveList';

function Probe({ items }: { items: number[] }) {
  const page = useProgressiveList(items);
  return <span>{`${page.shown}/${page.total}/${page.remaining}/${page.visible[page.visible.length - 1] ?? ''}`}</span>;
}

describe('useProgressiveList', () => {
  it('renders only the first page of a long list', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    expect(renderToStaticMarkup(<Probe items={items} />)).toContain(`${LIST_PAGE_SIZE}/1000/${1000 - LIST_PAGE_SIZE}/${LIST_PAGE_SIZE - 1}`);
  });

  it('returns short lists untouched', () => {
    expect(renderToStaticMarkup(<Probe items={[1, 2, 3]} />)).toContain('3/3/0/3');
  });
});

describe('ShowMoreBar', () => {
  const noop = () => {};

  it('is hidden when everything is shown', () => {
    expect(renderToStaticMarkup(<ShowMoreBar isRtl shown={10} total={10} pageSize={60} onMore={noop} onAll={noop} />)).toBe('');
  });

  it('offers the next page and "show all" for moderate lists', () => {
    const html = renderToStaticMarkup(<ShowMoreBar isRtl shown={60} total={100} pageSize={60} onMore={noop} onAll={noop} />);
    expect(html).toContain('عرض 60 من 100');
    expect(html).toContain('عرض 40 إضافي');
    expect(html).toContain('عرض الكل');
  });

  it('withholds "show all" when it would render thousands of rows', () => {
    const html = renderToStaticMarkup(<ShowMoreBar isRtl={false} shown={60} total={20000} pageSize={60} onMore={noop} onAll={noop} />);
    expect(html).toContain('Show 60 more');
    expect(html).not.toContain('Show all');
  });
});
