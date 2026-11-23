---
aside: false
outline: false
---

<script setup lang="ts">
import { useData } from "vitepress";
const { isDark } = useData();
</script>

<OASpec :isDark="isDark" hide-branding />
