//! dsh-fasttool: each process has one immutable environment and working directory.
//! Replaces upstream per-user/session control configuration with process-local state.
pub(crate) use std::env::{current_dir, temp_dir, var, var_os};
