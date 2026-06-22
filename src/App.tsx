import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { CreateBlogView } from './components/CreateBlogView';
import { BlogEditorView } from './components/BlogEditorView';
import { PublishedBlogsView } from './components/PublishedBlogsView';
import type { Blog } from './components/MockData';
import { blogService } from './services/blogService';

const upsertBlogToFront = (items: Blog[], nextBlog: Blog): Blog[] => [
  nextBlog,
  ...items.filter((b) => b.id !== nextBlog.id),
];

function App() {
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [currentView, setCurrentView] = useState<'dashboard' | 'editor' | 'published'>('dashboard');
  const [selectedBlogId, setSelectedBlogId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Theme state: dark sidebar is active in editor view by default, light in dashboard view.
  const [isDarkSidebar, setIsDarkSidebar] = useState(false);

  // Left Sidebar Width Resizing state & handlers
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizingLeft, setIsResizingLeft] = useState(false);

  const startResizingLeft = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizingLeft(true);
  };

  useEffect(() => {
    if (!isResizingLeft) return;

    const handleMouseMove = (e: MouseEvent) => {
      // clientX is the horizontal coordinate of the mouse pointer
      const newWidth = e.clientX;
      if (newWidth > 180 && newWidth < 450) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft]);

  // Load blogs from backend on mount
  useEffect(() => {
    const loadBlogs = async () => {
      try {
        const data = await blogService.getBlogs();
        setBlogs(data);
      } catch (err) {
        console.error('Failed to load blogs:', err);
      }
    };
    loadBlogs();
  }, []);

  // Sync sidebar theme with view transitions
  useEffect(() => {
    if (currentView === 'editor') {
      setIsDarkSidebar(true);
    } else {
      setIsDarkSidebar(false);
    }
  }, [currentView]);

  // Navigate view handler
  const handleNavigate = (view: 'dashboard' | 'editor' | 'published', blogId?: string) => {
    setCurrentView(view);
    if (blogId) {
      setSelectedBlogId(blogId);
    }
  };

  // Create new blank blog prompt handler
  const handleNewBlog = () => {
    setCurrentView('dashboard');
    setSelectedBlogId(null);
  };

  // Toggle theme button handler
  const handleToggleSidebarTheme = () => {
    setIsDarkSidebar(!isDarkSidebar);
  };

  // Handle blog generation from prompt form — calls the backend AI endpoint
  const handleGenerateBlog = async (promptData: {
    prompt: string;
    blogType: string;
    tone: string;
    audience: string;
    language: string;
    length: string;
    seoKeywords: string;
    preferences: string[];
  }) => {
    setIsGenerating(true);
    try {
      const newBlog = await blogService.generateBlog(promptData);
      setBlogs((prev) => [newBlog, ...prev]);
      setSelectedBlogId(newBlog.id);
      setCurrentView('editor');
    } catch (err) {
      console.error('Blog generation failed:', err);
      alert('Blog generation failed. Make sure your OpenAI API key is set and the backend is running.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Update specific blog inside editor
  const handleUpdateBlog = async (updatedBlog: Blog) => {
    // Optimistic UI update
    setBlogs((prev) => upsertBlogToFront(prev, updatedBlog));

    try {
      const saved = await blogService.updateBlog(updatedBlog);
      setBlogs((prev) => upsertBlogToFront(prev, saved));
    } catch (err) {
      console.error('Failed to save blog:', err);
    }
  };

  // Find selected blog
  const selectedBlog = blogs.find((b) => b.id === selectedBlogId) || blogs[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#111111] font-sans">
      {/* Shared Sidebar */}
      <Sidebar
        currentView={currentView}
        selectedBlogId={selectedBlogId}
        blogs={blogs}
        onNavigate={handleNavigate}
        onNewBlog={handleNewBlog}
        isDarkSidebar={isDarkSidebar}
        style={{ width: sidebarWidth }}
      />

      {/* Vertical Drag Handle */}
      <div
        onMouseDown={startResizingLeft}
        className={`w-1 hover:w-1.5 active:w-1.5 cursor-col-resize h-full transition-all flex-shrink-0 select-none ${
          isResizingLeft
            ? 'bg-slate-500'
            : 'bg-slate-800 hover:bg-slate-600'
        }`}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {currentView === 'dashboard' ? (
          <CreateBlogView onGenerate={handleGenerateBlog} isGenerating={isGenerating} />
        ) : currentView === 'published' ? (
          <PublishedBlogsView
            blogs={blogs}
            onCreateNew={handleNewBlog}
            onOpenBlog={(blogId) => handleNavigate('editor', blogId)}
          />
        ) : (
          selectedBlog && (
            <BlogEditorView
              blog={selectedBlog}
              onBack={() => setCurrentView('dashboard')}
              onUpdateBlog={handleUpdateBlog}
              isDarkSidebar={isDarkSidebar}
              onToggleSidebarTheme={handleToggleSidebarTheme}
            />
          )
        )}
      </div>
    </div>
  );
}

export default App;
