import React from 'react';
import * as Icons from 'lucide-react';
import type { Blog } from './MockData';

interface SidebarProps {
  currentView: 'dashboard' | 'editor';
  selectedBlogId: string | null;
  blogs: Blog[];
  onNavigate: (view: 'dashboard' | 'editor', blogId?: string) => void;
  onNewBlog: () => void;
  isDarkSidebar: boolean;
  style?: React.CSSProperties;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  selectedBlogId,
  blogs,
  onNavigate,
  onNewBlog,
  isDarkSidebar,
  style,
}) => {
  // Navigation items definition
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { id: 'all-blogs', label: 'All Blogs', icon: 'FileText' },
    { id: 'drafts', label: 'Drafts', icon: 'FileEdit' },
    { id: 'templates', label: 'Templates', icon: 'Layers' },
    { id: 'ai-assistant', label: 'AI Assistant', icon: 'Bot' },
    { id: 'brand-voice', label: 'Brand Voice', icon: 'Volume2' },
    { id: 'history', label: isDarkSidebar ? 'Settings' : 'History', icon: isDarkSidebar ? 'Settings' : 'History' },
  ];

  // Dynamically render Lucide Icon
  const renderIcon = (iconName: string, className: string) => {
    const IconComponent = (Icons as any)[iconName];
    if (!IconComponent) return <Icons.FileText className={className} />;
    return <IconComponent className={className} />;
  };

  return (
    <div
      style={style}
      className={`flex-shrink-0 flex flex-col justify-between border-r transition-colors duration-300 ${
        isDarkSidebar
          ? 'bg-[#111111] border-[#262626] text-[#f5f5f5]'
          : 'bg-[#18181b] border-[#2f2f35] text-[#e5e7eb]'
      } h-screen overflow-y-auto p-4 select-none`}
    >
      <div className="flex flex-col gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center shadow-md shadow-black/30">
            <Icons.PenSquare className="w-4.5 h-4.5" />
          </div>
          <span
            className={`font-bold text-lg tracking-tight ${
              isDarkSidebar ? 'text-white' : 'text-slate-100'
            }`}
          >
            Inkflow AI
          </span>
        </div>

        {/* New Blog Button */}
        <button
          onClick={onNewBlog}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-slate-100 text-black font-medium rounded-xl shadow-lg shadow-black/20 active:scale-[0.98] transition-all"
        >
          <Icons.Plus className="w-4 h-4" />
          <span>New Blog</span>
        </button>

        {/* Navigation Section */}
        <nav className="flex flex-col gap-1">
          {menuItems.map((item) => {
            const isSelected =
              (item.id === 'dashboard' && currentView === 'dashboard') ||
              (item.id === 'drafts' && currentView === 'editor');

            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'dashboard') {
                    onNavigate('dashboard');
                  } else if (item.id === 'drafts' && blogs.length > 0) {
                    onNavigate('editor', selectedBlogId || blogs[0].id);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isSelected
                    ? isDarkSidebar
                      ? 'bg-white/10 text-white border border-white/20'
                      : 'bg-slate-100 text-slate-900 border border-slate-300'
                    : isDarkSidebar
                    ? 'hover:bg-white/5 text-slate-300 hover:text-white'
                    : 'hover:bg-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {renderIcon(
                  item.icon,
                  `w-4.5 h-4.5 ${isSelected ? (isDarkSidebar ? 'text-white' : 'text-slate-900') : 'text-slate-400'}`
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Recent Blogs */}
        <div className="flex flex-col gap-2">
          <span
            className={`text-[10px] font-bold tracking-wider px-3 uppercase ${
              isDarkSidebar ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            {isDarkSidebar ? 'Recent Blogs' : 'YOUR RECENT BLOGS'}
          </span>
          <div className="flex flex-col gap-1">
            {blogs.slice(0, 10).map((blog) => {
              const isSelected = currentView === 'editor' && selectedBlogId === blog.id;
              return (
                <button
                  key={blog.id}
                  onClick={() => onNavigate('editor', blog.id)}
                  className={`w-full flex items-start gap-3 px-3 py-2 rounded-xl text-left transition-all ${
                    isSelected
                      ? isDarkSidebar
                        ? 'bg-white/10 text-white border border-white/20'
                        : 'bg-slate-100 text-slate-900 border border-slate-300'
                      : isDarkSidebar
                      ? 'hover:bg-white/5 text-slate-300 hover:text-white'
                      : 'hover:bg-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  <Icons.FileText
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      isSelected ? (isDarkSidebar ? 'text-white' : 'text-slate-900') : 'text-slate-400'
                    }`}
                  />
                  <div className="overflow-hidden">
                    <p className="text-xs font-medium truncate leading-tight">
                      {blog.title}
                    </p>
                    <span
                      className={`text-[9px] ${
                        isDarkSidebar ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      {blog.lastSaved.replace('Saved ', '')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Upgrade to Pro Card */}
      <div
        className={`rounded-2xl p-4 flex flex-col gap-3 mt-4 border transition-colors ${
          isDarkSidebar
            ? 'bg-[#1a1a1a] border-[#303030]'
            : 'bg-[#202026] border-[#35353d]'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Icons.Crown className="w-4 h-4 text-slate-200 fill-slate-200" />
          <span
            className={`text-xs font-bold ${
              isDarkSidebar ? 'text-slate-100' : 'text-slate-100'
            }`}
          >
            Upgrade to Pro
          </span>
        </div>

        <ul className="flex flex-col gap-1.5">
          {[
            'Unlimited blog generations',
            'Advanced AI models',
            'SEO optimization',
            'Brand voice cloning',
          ].map((feature, i) => (
            <li key={i} className="flex items-center gap-2 text-[10px] font-medium leading-none">
              <Icons.Check className="w-3.5 h-3.5 text-emerald-500 stroke-[3px]" />
              <span className={isDarkSidebar ? 'text-slate-300' : 'text-slate-300'}>{feature}</span>
            </li>
          ))}
        </ul>

        <button className="w-full py-2 bg-white hover:bg-slate-100 text-black text-xs font-semibold rounded-lg shadow-sm hover:shadow active:scale-[0.98] transition-all mt-1">
          Upgrade Now
        </button>
      </div>
    </div>
  );
};
