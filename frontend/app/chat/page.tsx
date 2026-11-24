import { Chat } from "@/components/chat";

// A knowledge base's public chat page (/chat?kb=<slug>), linked from the admin "Open chat page".
export default function ChatPage() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4 sm:px-6">
          <h1 className="font-medium">Help</h1>
          <span className="ml-3 text-sm text-muted-foreground">Answers from our help articles</span>
        </div>
      </header>
      <Chat
        className="flex-1"
        empty={
          <div className="mt-[12vh] max-w-md">
            <h2 className="text-3xl font-medium tracking-[-0.01em]">What do you need to know?</h2>
            <p className="mt-3 text-subtle">
              Ask in your own words. Every answer comes from our help articles and names the one it came from.
            </p>
          </div>
        }
      />
    </div>
  );
}
