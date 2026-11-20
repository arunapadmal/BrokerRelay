# CSV required / optional fields

`first_name,last_name,email,mobile,birthday,application_number,lender`

Required: `first_name`, `last_name`, `email`, `mobile`.
Optional: `birthday`, `application_number`, `lender`.

`birthday` = `DD/MM/YYYY` if provided; birth year is validated but **not stored**. The database stores only birthday month/day.

The parser also accepts common aliases: `first name`, `last name`, `phone`, `date of birth`, `dob`, `application no`, `loan number`, `lender name`.

Do **not** include sensitive loan amounts, account numbers, bank details, identification documents or client passwords in CSV exports. Restrict access to CRM export files.
