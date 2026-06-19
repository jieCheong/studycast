const BASE_URL = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("authToken");
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  uploadFile: async (file: File): Promise<{ uploadId: string }> => {
  const token = localStorage.getItem("authToken");
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${BASE_URL}/api/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Upload failed");
  }
  return data as { uploadId: string };
},

  signup: (email: string, password: string) =>
    request<{ id: string; email: string; createdAt: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () =>
    request<{ userId: string }>("/api/me"),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }),
  extractText: (uploadId: string) =>
    request("/api/extract", { method: "POST", body: JSON.stringify({ uploadId }) }),

  submitYoutubeUrl: (youtubeUrl: string) =>
    request<{ uploadId: string }>("/api/youtube", { method: "POST", body: JSON.stringify({ youtubeUrl }) }),

  generateScript: (uploadId: string, mode: string, language: string, length: string) =>
    request<{ transcript: string; jobId: string }>("/api/generate-script", {
      method: "POST",
      body: JSON.stringify({ uploadId, mode, language, length }),
    }),

  generateAudio: (jobId: string, voice?: string) =>
    request<{ audioUrl: string }>("/api/generate-audio", { method: "POST", body: JSON.stringify({ jobId, voice }) }),
  getHistory: () => request("/api/history"),
  getProfile: () => request("/api/profile"),
};
