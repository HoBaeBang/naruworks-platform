const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export type MemberProfile = {
  id: number;
  email: string;
  displayName: string;
  profileImageUrl: string | null;
  role: "USER" | "ADMIN";
  status: "APPROVED" | "PENDING" | "REJECTED" | "SUSPENDED";
  referralCode: string;
};

type ErrorResponse = {
  message?: string;
};

export async function getCurrentMember(): Promise<MemberProfile | null> {
  const response = await fetch(`${apiBaseUrl}/api/members/me`, {
    cache: "no-store",
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new Error(error.message ?? "회원 정보를 불러오지 못했습니다.");
  }

  return response.json() as Promise<MemberProfile>;
}

export async function logoutMember(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new Error(error.message ?? "로그아웃하지 못했습니다.");
  }
}
