import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Headphones, Download, LogOut, RotateCcw, X, Video as YoutubeIcon, History, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";

type JobStatus = "idle" | "uploading" | "extracting" | "embedding" | "generating-script" | "generating-audio" | "complete" | "failed";
type SourceType = "pdf" | "youtube";


const statusLabels: Record<JobStatus, string> = {
  idle: "",
  uploading: "Uploading file...",
  extracting: "Extracting text...",
  embedding: "Indexing content...",
  "generating-script": "Generating script with AI...",
  "generating-audio": "Creating audio...",
  complete: "Complete!",
  failed: "Generation failed",
};

const statusProgress: Record<JobStatus, number> = {
  idle: 0,
  uploading: 10,
  extracting: 25,
  embedding: 35,
  "generating-script": 50,
  "generating-audio": 75,
  complete: 100,
  failed: 0,
};

const voiceMap: Record<string, string> = {
  lecture: "onyx",
  podcast: "echo",
  calm: "shimmer",
  energetic: "nova",
};

const ACCEPTED_EXTENSIONS = [".pdf", ".pptx", ".docx", ".ppt", ".doc"];
const isAcceptedFile = (f: File) => {
  const name = f.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
};


export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<SourceType>("pdf");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [mode, setMode] = useState<string>("understanding");
  const [language, setLanguage] = useState<string>("English");
  const [length, setLength] = useState<string>("10");
  const [voice, setVoice] = useState<string>("lecture");

  const [status, setStatus] = useState<JobStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [generationCount, setGenerationCount] = useState(0);
  const [freeLimit, setFreeLimit] = useState(2);

  const audioRef = useRef<HTMLAudioElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const audioCardRef = useRef<HTMLDivElement>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const loadHistoryAndProfile = async () => {
    try {
      const [historyData, profileData] = await Promise.all([api.getHistory(), api.getProfile()]);
      setHistory((historyData as any).history);
      setGenerationCount((profileData as any).generationCount);
      setFreeLimit((profileData as any).freeLimit);
    } catch (err) {
      console.error("Failed to load history/profile:", err);
    }
  };

  useEffect(() => {
    loadHistoryAndProfile();
  }, []);


  // Auto-scroll to audio + apply playback rate
  useEffect(() => {
    if (status === "complete" && audioCardRef.current) {
      audioCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [status]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, audioUrl]);

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

const handleDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  const dropped = e.dataTransfer.files[0];
  if (dropped && ALLOWED_TYPES.includes(dropped.type)) {
    setFile(dropped);
  } else {
    toast({ title: "Invalid file", description: "Please upload a PDF, PPTX, or DOCX file.", variant: "destructive" });
  }
}, [toast]);

const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const selected = e.target.files?.[0];
  if (!selected) return;
  if (ALLOWED_TYPES.includes(selected.type) || isAcceptedFile(selected)) {
    setFile(selected);
  } else {
    toast({ title: "Invalid file", description: "Please upload a PDF, PPTX, or DOCX file.", variant: "destructive" });
  }
};

  const limitReached = generationCount >= freeLimit;

  const WORKER_STEPS = new Set<string>(["embedding", "generating-script", "generating-audio"]);

  const pollJobStatus = (jobId: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 150; // 5 minutes at 2s intervals
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(interval);
        reject(new Error("Generation timed out. Please try again."));
        return;
      }
      try {
        const data = await api.getJobStatus(jobId);

        if (data.status === "complete") {
          clearInterval(interval);
          resolve(data);
        } else if (data.status === "failed") {
          clearInterval(interval);
          reject(new Error(data.errorMessage || "Generation failed"));
        } else if (WORKER_STEPS.has(data.status)) {
          setStatus(data.status as JobStatus);
        }
        // else: queued/processing/extracting — keep polling without updating status
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 2000); // poll every 2 seconds
  });
};

const handleGenerate = async () => {
  if (!user) return;
  if (source === "pdf" && !file) return;
  if (source === "youtube" && !youtubeUrl.trim()) return;

  setErrorMsg("");

  try {
    let uploadId: string;

    if (source === "youtube") {
      setStatus("extracting");
      const uploadResult = await api.submitYoutubeUrl(youtubeUrl);
      uploadId = uploadResult.uploadId;
    } else {
      setStatus("uploading");
      const uploadResult = await api.uploadFile(file!);
      uploadId = uploadResult.uploadId;
      setStatus("extracting");
      await api.extractText(uploadId);
    }

    setStatus("generating-script");
    const jobResult = await api.createJob(uploadId, mode, language, length, voiceMap[voice]);

    const completedJob = await pollJobStatus(jobResult.jobId);

    setTranscript(completedJob.transcript);
    setAudioUrl(completedJob.audioUrl);
    setStatus("complete");
    loadHistoryAndProfile();
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    toast({ title: "Audio ready!", description: "Your study audio has been generated." });
  } catch (error: any) {
    console.error("Generation error:", error);
    const message = error instanceof Error ? error.message : "Something went wrong";
    setStatus("failed");
    setErrorMsg(message);
    toast({ title: "Generation failed", description: message, variant: "destructive" });
  }
};

  const resetState = () => {
    setStatus("idle");
    setFile(null);
    setYoutubeUrl("");
    setTranscript("");
    setAudioUrl("");
    setErrorMsg("");
  };

  const isProcessing = !["idle", "complete", "failed"].includes(status);
  const canGenerate =
    !limitReached && (source === "pdf" ? !!file : youtubeUrl.trim().length > 0);

  return (
    <TooltipProvider>
    <div className="min-h-screen">
      {/* Header */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <span className="text-xl font-bold font-['Space_Grotesk'] tracking-tight">
          StudyCast<span className="text-primary">AI</span>
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {generationCount} / {freeLimit} free generations used
          </span>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <AnimatePresence mode="wait">
          {status === "complete" ? (
            /* Results View */
            <motion.div
              ref={resultsRef}
              key="results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Your Audio is Ready</h1>
                <Button variant="outline" size="sm" onClick={resetState} className="gap-2">
                  <RotateCcw className="h-4 w-4" /> Generate Another
                </Button>
              </div>

              <Card ref={audioCardRef}>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Headphones className="h-5 w-5 text-primary" />
                    <span className="font-medium truncate">{file?.name ?? (youtubeUrl ? "YouTube transcript" : "Generation")}</span>
                  </div>
                  <audio ref={audioRef} controls className="w-full" src={audioUrl}>
                    Your browser does not support the audio element.
                  </audio>
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <span className="text-xs text-muted-foreground mr-1">Speed:</span>
                    {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                      <Button
                        key={speed}
                        variant={playbackSpeed === speed ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleSpeedChange(speed)}
                      >
                        {speed}x
                      </Button>
                    ))}
                  </div>
                  <a href={audioUrl} download={`studycast_${(file?.name ?? "audio").replace(/\.[^.]+$/, "")}.mp3`}>
                    <Button variant="outline" className="w-full gap-2">
                      <Download className="h-4 w-4" /> Download MP3
                    </Button>
                  </a>
                </CardContent>
              </Card>

              {transcript && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5" /> Transcript
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {transcript}
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          ) : isProcessing || status === "failed" ? (
            /* Processing View */
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <h1 className="text-2xl font-bold">
                {status === "failed" ? "Generation Failed" : "Generating Your Audio..."}
              </h1>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <Progress value={statusProgress[status]} className="h-2" />
                  <p className="text-sm text-muted-foreground text-center">
                    {statusLabels[status]}
                  </p>
                  {status === "failed" && (
                    <div className="space-y-3">
                      <p className="text-sm text-destructive text-center">{errorMsg}</p>
                      <Button onClick={resetState} variant="outline" className="w-full">
                        Try Again
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            /* Upload & Configure View */
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <h1 className="text-2xl font-bold">Create Study Audio</h1>

              {/* Source selector */}
              <Card>
                <CardContent className="pt-6">
                  <Tabs value={source} onValueChange={(v) => setSource(v as SourceType)} className="w-full">
                    <TabsList className="grid grid-cols-2 w-full mb-4">
                      <TabsTrigger value="pdf" className="gap-2"><FileText className="h-4 w-4" /> File</TabsTrigger>
                      <TabsTrigger value="youtube" className="gap-2"><YoutubeIcon className="h-4 w-4" /> YouTube URL</TabsTrigger>
                    </TabsList>

                    <TabsContent value="pdf" className="mt-0">
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                        className="border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/50 transition-colors cursor-pointer"
                        onClick={() => document.getElementById("pdf-input")?.click()}
                      >
                        {file ? (
                          <div className="flex items-center justify-center gap-3">
                            <FileText className="h-8 w-8 text-primary" />
                            <div className="text-left">
                              <p className="font-medium">{file.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {(file.size / 1024 / 1024).toFixed(1)} MB
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ml-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFile(null);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                            <p className="font-medium">Drop your file here or click to browse</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              Lecture slides, notes, textbook chapters · PDF, PPTX, DOCX · Max 10MB
                            </p>
                          </>
                        )}
                        <input
                          id="pdf-input"
                          type="file"
                          accept=".pdf,.pptx,.docx,.mp4,.mov,.webm"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="youtube" className="mt-0">
                      <div className="space-y-3">
                        <Label htmlFor="yt-url">YouTube video URL</Label>
                        <Input
                          id="yt-url"
                          type="url"
                          placeholder="https://www.youtube.com/watch?v=..."
                          value={youtubeUrl}
                          onChange={(e) => setYoutubeUrl(e.target.value)}
                        />
                        <p className="text-sm text-muted-foreground">
                          We'll fetch the video's transcript and turn it into a study audio.
                        </p>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Configuration</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Study Mode</Label>
                    <Select value={mode} onValueChange={setMode}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="understanding">Understanding</SelectItem>
                        <SelectItem value="memorization">Memorization</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="Korean">Korean</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Length</Label>
                    <Select value={length} onValueChange={setLength}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Voice Style</Label>
                    <Select value={voice} onValueChange={setVoice}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lecture">Lecture</SelectItem>
                        <SelectItem value="podcast">Podcast</SelectItem>
                        <SelectItem value="calm">Calm</SelectItem>
                        <SelectItem value="energetic">Energetic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {limitReached && (
                <p className="text-sm text-destructive text-center">
                  You've used all {freeLimit} free generations.
                </p>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-full">
                    <Button
                      className="w-full h-12 text-base gap-2"
                      onClick={handleGenerate}
                      disabled={!canGenerate || isProcessing}
                    >
                      <Headphones className="h-5 w-5" /> Generate Audio
                    </Button>
                  </div>
                </TooltipTrigger>
                {limitReached && (
                  <TooltipContent>You've used all free generations.</TooltipContent>
                )}
              </Tooltip>

              {/* Recent generations */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <History className="h-5 w-5" /> Recent Generations
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No generations yet</p>
                  ) : (
                    history.map((r: any) => (
                      <div key={r.jobId} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">{r.filename}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {r.audioUrl && (
                          <>
                            <audio controls className="w-full h-8" src={r.audioUrl} />
                            <a href={r.audioUrl} download={`studycast_${r.filename.replace(/\.[^.]+$/, "")}.mp3`}>
                              <Button variant="ghost" size="sm" className="gap-2 h-7">
                                <Download className="h-3.5 w-3.5" /> Download
                              </Button>
                            </a>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Delete Account */}
              <div className="pt-4 pb-2 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete Account
                </Button>
              </div>

              <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Your Account</DialogTitle>
                    <DialogDescription className="pt-2 space-y-3">
                      <span className="block">
                        Account deletion is handled via email to keep things simple and verifiable.
                        To request deletion of your account and all associated data, send an email to:
                      </span>
                      <span className="block font-medium text-foreground">
                        testemail07077@gmail.com
                      </span>
                      <span className="block">
                        Use the subject line <span className="font-medium text-foreground">Account Deletion Request</span> and include the email address associated with your account. We'll process your request and delete your data promptly.
                      </span>
                      <span className="block text-xs">
                        For more details on what data we hold and how deletion works, see our{" "}
                        <a href="/privacy" className="underline text-primary" target="_blank" rel="noreferrer">Privacy Policy</a>.
                      </span>
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                      Cancel
                    </Button>
                    <a
                      href="mailto:testemail07077@gmail.com?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20account%20associated%20with%20this%20email%20address."
                    >
                      <Button variant="destructive" className="gap-2" onClick={() => setShowDeleteDialog(false)}>
                        <Trash2 className="h-4 w-4" /> Open Email
                      </Button>
                    </a>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
    </TooltipProvider>
  );
}