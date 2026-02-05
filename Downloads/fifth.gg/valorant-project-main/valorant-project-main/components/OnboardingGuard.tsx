"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuth } from "@/lib/AuthContext"

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
    const { user, userProfile, loading } = useAuth()
    const router = useRouter()
    const pathname = usePathname()

    useEffect(() => {
        if (!loading && user && userProfile) {
            // Check if profile is complete (has in_game_name and tagline)
            const isProfileComplete = userProfile.in_game_name && userProfile.tagline
            const isOnboardingPage = pathname === "/onboarding"

            // If profile incomplete and not on onboarding page, redirect to onboarding
            if (!isProfileComplete && !isOnboardingPage) {
                router.push("/onboarding")
            }
        }
    }, [user, userProfile, loading, pathname, router])

    return <>{children}</>
}
