import React, { useMemo } from 'react';
import * as Icons from 'lucide-react';
import type { Blog } from './MockData';

interface PublishedBlogsViewProps {
  blogs: Blog[];
  onOpenBlog: (blogId: string) => void;
  onCreateNew: () => void;
}

const getPreviewText = (blog: Blog): string => {
  const firstTextual = blog.sections.find((section) => section.type !== 'image' && (section.text || '').trim().length > 0);
  const text = (firstTextual?.text || blog.subtitle || '').trim();
  if (!text) return 'Published blog ready for review.';
  if (text.length <= 220) return text;
  return `${text.slice(0, 220).trim()}...`;
};

export const PublishedBlogsView: React.FC<PublishedBlogsViewProps> = ({
  blogs,
  onOpenBlog,
  onCreateNew,
}) => {
  const publishedBlogs = useMemo(
    () =>
      blogs
        .filter((blog) => Boolean(blog.devtoUrl))
        .sort((a, b) => {
          const aTime = a.devtoPublishedAt ? new Date(a.devtoPublishedAt).getTime() : 0;
          const bTime = b.devtoPublishedAt ? new Date(b.devtoPublishedAt).getTime() : 0;
          return bTime - aTime;
        }),
    [blogs]
  );

  return (
    <div className="flex-1 min-h-screen bg-[#0f1115] overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Published Blogs</h1>
            <p className="text-sm text-slate-400 mt-1">
              All blogs published to Dev.to in one place.
            </p>
          </div>
          <button
            onClick={onCreateNew}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-slate-100 transition-colors"
          >
            <Icons.Plus className="w-4 h-4" />
            <span>New Blog</span>
          </button>
        </div>

        {publishedBlogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#343a46] bg-[#171a21] p-10 text-center">
            <div className="w-11 h-11 rounded-xl bg-white/10 mx-auto flex items-center justify-center mb-3">
              <Icons.Send className="w-5 h-5 text-slate-200" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">No published blogs yet</h2>
            <p className="text-sm text-slate-400 mt-1">
              Publish any blog from the editor and it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {publishedBlogs.map((blog) => (
              <article
                key={blog.id}
                className="rounded-2xl border border-[#2e3440] bg-[#171a21] p-5 shadow-lg shadow-black/20 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <Icons.CheckCircle2 className="w-3.5 h-3.5" />
                    Published
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {blog.devtoPublishedAt ? new Date(blog.devtoPublishedAt).toLocaleDateString() : 'Unknown date'}
                  </span>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-slate-100 leading-tight">{blog.title}</h3>
                  {blog.subtitle ? (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{blog.subtitle}</p>
                  ) : null}
                </div>

                <p className="text-sm text-slate-300 leading-relaxed min-h-[88px]">{getPreviewText(blog)}</p>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[#11151d] border border-[#2a2f3a] py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Words</p>
                    <p className="text-xs font-semibold text-slate-200 mt-0.5">{blog.words.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-[#11151d] border border-[#2a2f3a] py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Read</p>
                    <p className="text-xs font-semibold text-slate-200 mt-0.5">{blog.readTime}</p>
                  </div>
                  <div className="rounded-lg bg-[#11151d] border border-[#2a2f3a] py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">SEO</p>
                    <p className="text-xs font-semibold text-slate-200 mt-0.5">{blog.seoScore}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => onOpenBlog(blog.id)}
                    className="flex-1 py-2 px-3 rounded-xl border border-[#384255] text-slate-100 hover:bg-slate-800 text-xs font-semibold transition-colors"
                  >
                    Open in Editor
                  </button>
                  {blog.devtoUrl ? (
                    <a
                      href={blog.devtoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 px-3 rounded-xl border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 text-xs font-semibold transition-colors"
                    >
                      Open Link
                    </a>
                  ) : (
                    <div className="flex-1 text-center py-2 px-3 rounded-xl border border-[#2f3642] text-slate-500 text-xs font-semibold">
                      No Link
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

