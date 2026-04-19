import { ArrowRightCircle, ClipboardList, Bot, Inbox, Lightbulb, NotepadText, ListTodo, FolderOpen, Clock, MessageSquare } from "lucide-react";
import type { DetailTab } from "@/types";

interface TabBarProps {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  hasDeal?: boolean;
}

const BASE_TABS: { id: DetailTab; label: string; icon: typeof ArrowRightCircle }[] = [
  { id: "action",   label: "Next Action", icon: ArrowRightCircle },
  { id: "details",  label: "Details",     icon: ClipboardList },
  { id: "research", label: "Research",    icon: Bot },
  { id: "emails",   label: "Emails",      icon: Inbox },
  { id: "solution", label: "Solution",    icon: Lightbulb },
];

const DEAL_TABS: { id: DetailTab; label: string; icon: typeof ArrowRightCircle }[] = [
  { id: "notes", label: "Notes", icon: NotepadText },
  { id: "todos", label: "Todos", icon: ListTodo },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "timeline", label: "Timeline", icon: Clock },
];

export default function TabBar({ activeTab, onTabChange, hasDeal = true }: TabBarProps) {
  return (
    <div className="flex items-center border-b border-slate-200 px-3 overflow-x-auto scrollbar-none flex-shrink-0 min-w-0">
      {/* Primary tabs */}
      <div className="flex items-center gap-0.5">
        {BASE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap ${
                isActive ? "text-blue-600" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
              )}
            </button>
          );
        })}

      </div>

      {/* Separator + deal tabs */}
      {hasDeal && (
        <>
          <div className="mx-1.5 h-4 w-px bg-slate-200 flex-shrink-0" />
          <div className="flex items-center gap-0.5">
            {DEAL_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isChat = tab.id === "chat";
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  title={tab.label}
                  className={`relative inline-flex items-center justify-center gap-1 rounded transition-colors group
                    px-2.5 py-2.5 text-xs font-medium whitespace-nowrap
                    md:gap-0 md:px-0 md:py-0 md:w-8 md:h-8
                    ${isChat
                      ? isActive
                        ? "text-blue-600 md:bg-blue-50"
                        : "text-blue-400 hover:text-blue-600 md:hover:bg-blue-50"
                      : isActive
                        ? "text-blue-600 md:bg-blue-50"
                        : "text-slate-400 hover:text-slate-600 md:hover:bg-slate-50"
                    }`}
                >
                  <Icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  <span className="md:hidden">{tab.label}</span>
                  <span className="hidden md:block absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-medium text-white bg-slate-800 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    {tab.label}
                  </span>
                  {isActive && (
                    <span className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-t md:bottom-[-5px] md:left-1 md:right-1 ${isChat ? "bg-blue-600" : "bg-blue-600"}`} />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Ask AI — pinned to the right */}
      {hasDeal && (
        <div className="ml-auto pl-2 flex-shrink-0">
          {(() => {
            const isActive = activeTab === "chat";
            return (
              <button
                onClick={() => onTabChange("chat")}
                className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 my-1 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Ask AI
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
