const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export type AdminMember = {
  id: number;
  email: string;
  displayName: string;
  profileImageUrl: string | null;
  role: "USER" | "ADMIN";
  status: "APPROVED" | "PENDING" | "REJECTED" | "SUSPENDED";
  referrerMemberId: number | null;
  referralCode: string;
  createdAt: string;
  approvedAt: string | null;
  lastLoginAt: string;
};

type ErrorResponse = {
  message?: string;
};

export class AdminMemberApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AdminMemberApiError";
  }
}

async function getErrorMessage(response: Response, fallback: string) {
  const error = (await response.json().catch(() => ({}))) as ErrorResponse;

  return error.message ?? fallback;
}

export async function getAdminMembers(): Promise<AdminMember[]> {
  const response = await fetch(`${apiBaseUrl}/api/admin/members`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new AdminMemberApiError(
      await getErrorMessage(response, "회원 목록을 불러오지 못했습니다."),
      response.status,
    );
  }

  return response.json() as Promise<AdminMember[]>;
}

export async function updateAdminMemberStatus(
  memberId: number,
  status: AdminMember["status"],
): Promise<AdminMember> {
  const response = await fetch(
    `${apiBaseUrl}/api/admin/members/${memberId}/status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    },
  );

  if (!response.ok) {
    throw new AdminMemberApiError(
      await getErrorMessage(response, "회원 상태를 변경하지 못했습니다."),
      response.status,
    );
  }

  return response.json() as Promise<AdminMember>;
}
